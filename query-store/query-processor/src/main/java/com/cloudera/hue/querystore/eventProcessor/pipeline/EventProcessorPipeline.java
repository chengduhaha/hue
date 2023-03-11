// (c) Copyright 2020-2021 Cloudera, Inc. All rights reserved.
package com.cloudera.hue.querystore.eventProcessor.pipeline;

import java.io.IOException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Iterator;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

import org.apache.hadoop.fs.FileStatus;
import org.apache.hadoop.fs.Path;
import org.apache.hadoop.io.IOUtils;
import org.apache.hadoop.yarn.util.Clock;

import com.cloudera.hue.querystore.common.config.DasConfiguration;
import com.cloudera.hue.querystore.common.config.DasConfiguration.ConfVar;
import com.cloudera.hue.querystore.common.entities.FileStatusEntity;
import com.cloudera.hue.querystore.common.entities.FileStatusEntity.FileStatusType;
import com.cloudera.hue.querystore.common.repository.FileStatusPersistenceManager;
import com.cloudera.hue.querystore.common.repository.transaction.TransactionManager;
import com.cloudera.hue.querystore.eventProcessor.dispatchers.EventDispatcher;
import com.cloudera.hue.querystore.eventProcessor.lifecycle.CleanupManager;
import com.cloudera.hue.querystore.eventProcessor.processors.ProcessingStatus;
import com.cloudera.hue.querystore.eventProcessor.readers.EventReader;
import com.cloudera.hue.querystore.eventProcessor.readers.FileReader;
import com.codahale.metrics.Gauge;
import com.codahale.metrics.Meter;
import com.codahale.metrics.MetricRegistry;
import com.google.common.util.concurrent.ThreadFactoryBuilder;

import lombok.extern.slf4j.Slf4j;

@Slf4j
public class EventProcessorPipeline<T> {
  public static final ConfVar<Long> FOLDER_SCAN_DELAY_MILLIS =
      new ConfVar<>("hue.query-processor.event-pipeline.folder-scan-delay-millis", 5 * 60 * 1000l); // 5 minutes
  public static final ConfVar<Long> AUTO_CLOSE_DELAY_MILLIS =
      new ConfVar<>("hue.query-processor.event-pipeline.autoclose-delay-millis", 4 * 24 * 3600 * 1000l); // 4 days
  public static final ConfVar<Long> HDFS_SYNC_WAIT_TIME_MILLIS =
      new ConfVar<>("hue.query-processor.event-pipeline.hdfs-sync-wait-time-millis", 2 * 60 * 1000l); // 2 minutes
  public static final ConfVar<Integer> MAX_PARALLELISM =
      new ConfVar<>("hue.query-processor.event-pipeline.max-parallelism", 50);

  protected static final long REFRESH_THROTTLE_MILLIS = 2000;

  private final Clock clock;
  private final FileReader<T> fileReader;
  private final EventDispatcher<T> eventDispatcher;
  private final TransactionManager txnManager;
  private final FileStatusPersistenceManager fsPersistenceManager;
  private final FileStatusType type;
  private final DasConfiguration config;
  private final MetricRegistry metricRegistry;

  // constants loaded from config.
  private final long syncTime;
  private final long refreshDelay;
  private final long expiryTime;

  private final ScheduledExecutorService filesRefresherExecutor;
  private final ExecutorService eventProcessorExecutor;
  private static final int INIT = 0, START = 1, STOPPED = 2;
  private final AtomicInteger state = new AtomicInteger(INIT);

  private final Meter eventsProcessedMeter;
  private final Meter eventsProcessingFailureMeter;

  private final AtomicLong refreshTime = new AtomicLong(0l);
  public long getRefreshTime() {
    return refreshTime.get();
  }

  // The current directory we are scanning for new or changed files.
  private String scanDir;
  private final ConcurrentHashMap<String, FileProcessingStatus> scanDirEntities =
      new ConcurrentHashMap<>();

  private final List<FileProcessingStatus> previousEntities = new ArrayList<>();

  // The new files which have to be scanned.
  private final LinkedBlockingQueue<FileProcessingStatus> filesQueue = new LinkedBlockingQueue<>();

  public EventProcessorPipeline(Clock clock, FileReader<T> fileReader,
      EventDispatcher<T> eventDispatcher, TransactionManager txnManager,
      FileStatusPersistenceManager fsPersistenceManager, FileStatusType type,
      DasConfiguration dasConfig, MetricRegistry metricRegistry) {
    this.clock = clock;
    this.fileReader = fileReader;
    this.eventDispatcher = eventDispatcher;
    this.txnManager = txnManager;
    this.fsPersistenceManager = fsPersistenceManager;
    this.type = type;
    this.config = dasConfig;
    this.metricRegistry = metricRegistry;

    eventsProcessedMeter = metricRegistry.meter(type.name() + ".eventsProcessed");
    eventsProcessingFailureMeter = metricRegistry.meter(type.name() + ".eventsProcessingFailure");

    this.syncTime = dasConfig.getConf(HDFS_SYNC_WAIT_TIME_MILLIS) / 1000;
    this.refreshDelay = dasConfig.getConf(FOLDER_SCAN_DELAY_MILLIS);
    this.expiryTime = dasConfig.getConf(AUTO_CLOSE_DELAY_MILLIS);
    int parallelism = dasConfig.getConf(MAX_PARALLELISM);

    ThreadFactoryBuilder builder = new ThreadFactoryBuilder().setUncaughtExceptionHandler(
        (t, e) -> log.error("Uncaught exception in thread: {}", t.getName(), e));
    this.filesRefresherExecutor = Executors.newSingleThreadScheduledExecutor(
        builder.setNameFormat(type + " file refresher: %d").build());
    this.eventProcessorExecutor = new ThreadPoolExecutor(
        Math.min(10, parallelism), parallelism,
        refreshDelay * 10, TimeUnit.MILLISECONDS,
        new LinkedBlockingQueue<Runnable>(),
        builder.setNameFormat(type + " file events processor: %d").build());
  }

  public void start() {
    if (state.compareAndSet(INIT, START)) {
      log.info("Starting pipeline for: " + type);

      // Register guages
      metricRegistry.register(type.name() + ".previousFiles", (Gauge<Integer>)() -> previousEntities.size());
      metricRegistry.register(type.name() + ".currentQueueSize", (Gauge<Integer>)() -> filesQueue.size());

      this.loadOffsets();
      filesRefresherExecutor.scheduleWithFixedDelay(this::refresh, 0, refreshDelay, TimeUnit.MILLISECONDS);
      log.info("Started pipeline for: " + type);
    } else {
      log.error("Trying to start in invalid state: " + state.get());
      throw new IllegalStateException("Trying to start but current state is: " + state.get());
    }
  }

  public void shutdown() {
    if (state.compareAndSet(START, STOPPED)) {
      log.info("Shutting down pipeline for: " + type);
      filesRefresherExecutor.shutdown();
      eventProcessorExecutor.shutdown();
    } else {
      throw new IllegalStateException("Trying to shutdown but current state is: " + state.get());
    }
  }

  public void awaitTermination() {
    if (state.get() != STOPPED) {
      throw new IllegalStateException("Expected stopped but current state is: " + state.get());
    }
    try {
      filesRefresherExecutor.awaitTermination(60, TimeUnit.SECONDS);
      eventProcessorExecutor.awaitTermination(60, TimeUnit.SECONDS);
    } catch (InterruptedException e) {
      log.error("Got interrupt while waiting to finish type {}: ", type, e);
    }
    log.info("Shutdown pipeline for: " + type);
  }

  private void loadOffsets() {
    log.info("Loading offsets for: " + type);
    Collection<FileStatusEntity> savedOffsets = txnManager.withTransaction(
          () -> fsPersistenceManager.getFileOfType(type));
    LocalDate maxDate = CleanupManager.getMinDateForProcessing(clock, config);
    for (FileStatusEntity fsEntity : savedOffsets) {
      if (fsEntity.getDate().compareTo(maxDate) > 0) {
        maxDate = fsEntity.getDate();
      }
    }
    for (FileStatusEntity fsEntity : savedOffsets) {
      FileProcessingStatus fps = new FileProcessingStatus(fsEntity);
      if (fsEntity.getDate().equals(maxDate)) {
        this.scanDirEntities.put(fsEntity.getFilePath(), fps);
      } else {
        this.previousEntities.add(fps);
      }
    }
    this.scanDir = fileReader.getDirForDate(maxDate);
    log.info("Offsets loaded for {}, scanDir: {}", type, scanDir);
  }

  private void refreshCurrent() {
    log.trace("refreshCurrent started for type: {}", type);
    try {
      loadMore();
      addNonFinished();
    } catch (IOException e) {
      log.error("Error occured while trying to find new files for type: {}", type, e);
    }
    log.trace("refreshCurrent finished for type: {}", type);
  }

  private void refreshOld() {
    log.trace("refreshOld started for type: {}", type);
    long minTime = clock.getTime() - expiryTime;
    Iterator<FileProcessingStatus> iter = previousEntities.iterator();
    while (iter.hasNext()) {
      FileProcessingStatus fps = iter.next();
      // Remove finished or expired entities.
      try {
        if (fps.removeIfOlder(txnManager, fsPersistenceManager, minTime)) {
          iter.remove();
        }
      } catch (Exception e) {
        log.error("Caught a throwable while processing type: " + type, e);
        // some error happened here, should we have a retry count on this and remove a file if
        // for some reason it always fails.
        continue;
      }
      if (fps.shouldRefreshOld(fileReader)) {
        filesQueue.add(fps);
      }
    }
    log.trace("refreshOld finished for type: {}", type);
  }

  private void processQueue() {
    FileProcessingStatus fps = filesQueue.poll();
    while (fps != null) {
      FileStatusEntity entity = fps.getEntity();
      log.trace("Submitting file: {}, date: {}, type: {}",
          entity.getFilePath(), entity.getDate(), type);
      eventProcessorExecutor.execute(new FileEventsProcessor(fps));
      fps = filesQueue.poll();
    }
  }

  private void refresh() {
    if ((clock.getTime() - refreshTime.get()) > REFRESH_THROTTLE_MILLIS) {
      log.debug("Refreshing for type " + type);
      try {
        this.refreshCurrent();
        this.processQueue();
        this.refreshOld();
        this.processQueue();

        refreshTime.set(clock.getTime());
      } catch (Throwable t) {
        log.error("Caught throwable while refereshing type: " + type, t);
      }
      log.debug("Refreshing finished " + type);
    }
  }

  public void forceRefresh() {
    filesRefresherExecutor.execute(this::refresh);
  }

  private void updateScanDir(String newDir) {
    previousEntities.addAll(scanDirEntities.values());
    this.scanDirEntities.clear();
    this.scanDir = newDir;
    log.debug("Changed to new dir: {}, for type: {}", newDir, type);
  }

  private String getRelativePath(FileStatus status) {
    String path = status.getPath().toString();
    String[] parts = path.split(scanDir);
    if(parts.length == 2) {
      path = parts[1].substring(1); // Remove forward slash
    } else {
      // Gracefully handle
      log.error("Invalid file path {}. Scan directory '{}' not found", path, scanDir);
    }
    return path;
  }

  private void addAll(List<FileStatus> changedFiles) {
    LocalDate scanDate = fileReader.getDateFromDir(scanDir);

    for (FileStatus status : changedFiles) {
      String relativeFilePath = getRelativePath(status);

      FileProcessingStatus fps = scanDirEntities.get(relativeFilePath);
      if (fps == null) {
        // New file found add to database.
        FileStatusEntity entity = new FileStatusEntity();
        entity.setFileType(type);
        entity.setDate(scanDate);
        entity.setFilePath(relativeFilePath);
        entity.setFinished(false);
        entity.setLastEventTime(clock.getTime());
        entity.setPosition(0L);
        log.debug("Adding file: {} to db of type {}", entity.getFilePath(), type);
        fps = new FileProcessingStatus(fsPersistenceManager.create(entity));
        scanDirEntities.put(relativeFilePath, fps);
      }
      if (fps.schedule()) {
        filesQueue.add(fps);
      }
    }
  }

  private void addNonFinished() {
    // We retry all files for the day, since the file can have more data but the length need not be
    // updated, this will cause more refreshes, but that cannot be avoided.
    for (FileProcessingStatus fps : scanDirEntities.values()) {
      if (fps.schedule()) {
        filesQueue.add(fps);
      }
    }
  }

  private List<FileStatus> removeFinished(List<FileStatus> changedFiles) {
    Iterator<FileStatus> iter = changedFiles.iterator();
    while (iter.hasNext()) {
      FileStatus status = iter.next();
      String relativeFilePath = getRelativePath(status);
      FileProcessingStatus fps = scanDirEntities.get(relativeFilePath);
      // TODO: Add recovery, there is data. We should use sequence file recovery to move ahead and
      // read more events.
      if (fps != null && fps.isFinished(status.getLen())) {
        iter.remove();
      }
    }
    return changedFiles;
  }

  private boolean loadMore() throws IOException {
    ImmutableMapView<String, FileProcessingStatus, Long> scanDirOffsets =
        new ImmutableMapView<>(scanDirEntities, a -> a.getPosition());
    List<FileStatus> changedFiles = fileReader.scanForChangedFiles(scanDir, scanDirOffsets);
    changedFiles = removeFinished(changedFiles);
    while (changedFiles.isEmpty()) {
      LocalDateTime utcNow = fileReader.getNow();
      if (utcNow.getHour() * 3600 + utcNow.getMinute() * 60 + utcNow.getSecond() < syncTime) {
        // We are in the delay window for today, do not advance date if we are moving from
        // yesterday.
        String yesterDir = fileReader.getDirForDate(utcNow.toLocalDate().minusDays(1));
        if (yesterDir.equals(scanDir)) {
          return false;
        }
      }
      String nextDir = fileReader.getNextDirectory(scanDir);
      if (nextDir == null || utcNow.toLocalDate().compareTo(fileReader.getDateFromDir(nextDir)) < 0) {
        return false;
      }
      updateScanDir(nextDir);
      changedFiles = fileReader.scanForChangedFiles(scanDir, scanDirOffsets);
      changedFiles = removeFinished(changedFiles);
    }
    addAll(changedFiles);
    return true;
  }

  public class FileEventsProcessor implements Runnable {
    private final FileProcessingStatus fileStatus;

    FileEventsProcessor(FileProcessingStatus fileStatus) {
      this.fileStatus = fileStatus;
    }

    @Override
    public void run() {
      try {
        runInternal();
      } finally {
        fileStatus.doneRunning();
      }
    }

    private void runInternal() {
      EventReader<T> reader = fileStatus.getEventReader(fileReader);
      if (reader == null) {
        return;
      }
      Path filePath = reader.getFilePath();
      log.trace("Started processing file: " + filePath);
      try {
        for (T evt = reader.read(); evt != null && state.get() == START; evt = reader.read()) {
          boolean isFinalEvent = processEvent(evt, filePath, reader.getLastOffset());
          fileStatus.updateEntity(isFinalEvent, reader.getOffset(), clock.getTime());
        }
        fileStatus.updatePosition(fsPersistenceManager);
      } catch (Exception e) {
        log.error("Error processing events for {}, retryCount: {}",
            filePath, fileStatus.getProcessRetryCount(), e);
      } finally {
        IOUtils.cleanupWithLogger(log, reader);
        log.trace("Finished processing file: " + filePath);
      }
    }

    @SuppressWarnings("fallthrough")
    private boolean processEvent(T evt, Path filePath, Long eventOffset) throws Exception {
      // We should get more information from processing status, it should be able to tell
      // us if an error is retriable and then should we ignore after retry or terminate
      // processing rest of the events in the file. Currently its terminate processing
      // And in some cases instead of returning a status we just throw an Exception, clean
      // that up.
      String filePathStr = fileStatus.getEntity().getFilePath();
      boolean isFinished = false;
      try {
        log.trace("Started processing event for file: {}, event: {}", filePathStr, evt);
        ProcessingStatus status = txnManager.withTransaction(() -> eventDispatcher.process(evt, filePath, eventOffset));
        switch (status.getStatus()) {
          case ERROR:
            throw new Exception("Error processing event", status.getError());
          case FINISH:
            log.trace("Recieved finish event for file: {}", filePathStr);
            isFinished = true;
          case SKIP:
          case SUCCESS:
            log.trace("Finished processing event for file: {}", filePathStr);
        }
        eventsProcessedMeter.mark();
        fileStatus.processingSuccess();
      } catch (Exception e) {
        eventsProcessingFailureMeter.mark();
        fileStatus.processingFailed(e);
      }
      return isFinished;
    }
  }
}
