// (c) Copyright 2020-2021 Cloudera, Inc. All rights reserved.
package com.cloudera.hue.querystore.eventProcessor.resources;

import java.io.IOException;
import java.net.URISyntaxException;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

import javax.inject.Inject;
import javax.ws.rs.Consumes;
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.PathParam;
import javax.ws.rs.Produces;
import javax.ws.rs.QueryParam;
import javax.ws.rs.core.Context;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.Response;
import javax.ws.rs.core.SecurityContext;

import org.apache.commons.lang.StringUtils;
import org.apache.hadoop.http.HttpConfig.Policy;
import org.apache.hadoop.yarn.conf.YarnConfiguration;

import com.cloudera.hue.querystore.common.AppAuthentication;
import com.cloudera.hue.querystore.common.dto.HiveQueryDto;
import com.cloudera.hue.querystore.common.entities.HiveQueryBasicInfo;
import com.cloudera.hue.querystore.common.entities.HiveQueryExtendedInfo;
import com.cloudera.hue.querystore.common.entities.VertexInfo;
import com.cloudera.hue.querystore.common.repository.HiveQueryBasicInfoRepository;
import com.cloudera.hue.querystore.common.repository.HiveQueryExtendedInfoRepository;
import com.cloudera.hue.querystore.common.repository.VertexInfoRepository;
import com.cloudera.hue.querystore.common.services.DagInfoService;

/**
 * Resource class for working with the hive ide Udfs
 */
@Path("/hive")
public class HiveQueryResource {
  private final HiveQueryBasicInfoRepository hiveQueryRepo;
  private final DagInfoService dagInfoService;
  private final HiveQueryExtendedInfoRepository queryDetailsService;
  private final VertexInfoRepository vertexInfoService;

  @Inject
  public HiveQueryResource(HiveQueryBasicInfoRepository hiveQueryRepo, DagInfoService dagInfoService,
                           HiveQueryExtendedInfoRepository queryDetailsService, VertexInfoRepository vertexInfoService) {
    this.hiveQueryRepo = hiveQueryRepo;
    this.dagInfoService = dagInfoService;
    this.queryDetailsService = queryDetailsService;
    this.vertexInfoService = vertexInfoService;
  }

  private boolean userCheck(HiveQueryBasicInfo hiveQuery, SecurityContext securityContext) {
      String user = hiveQuery.getRequestUser();
    return (securityContext.isUserInRole(AppAuthentication.Role.ADMIN.name())
        || (user != null && user.equals(securityContext.getUserPrincipal().getName())));
  }

  private Response getForHiveQuery(HiveQueryBasicInfo hiveQuery, SecurityContext securityContext, boolean extended) {
    if (!userCheck(hiveQuery, securityContext)) {
      return Response.status(Response.Status.UNAUTHORIZED).build();
    }
    HiveQueryDto query = new HiveQueryDto(hiveQuery);

    query.setDags(dagInfoService.getAllDagDetails(hiveQuery.getId(), extended));
    if (extended) {
      Optional<HiveQueryExtendedInfo> details = queryDetailsService.findByHiveQueryId(hiveQuery.getQueryId());
      if(details.isPresent()) {
        query.setQueryDetails(details.get());
      } else {
        return Response.status(Response.Status.NOT_FOUND).entity("Hive Query with query id '" + hiveQuery.getQueryId() + "' not found").build();
      }
    }
    return Response.ok(Collections.singletonMap("query", query)).build();
  }

  /**
   * Gets single query for the current user
   */
  @GET
  @Produces(MediaType.APPLICATION_JSON)
  @Path("/query/{id}")
  public Response getOne(@PathParam("id") Long id, @QueryParam("extended") boolean extended, @Context SecurityContext securityContext) {
    Optional<HiveQueryBasicInfo> hiveQuery = hiveQueryRepo.findOne(id);
    if (hiveQuery.isPresent()) {
      return getForHiveQuery(hiveQuery.get(), securityContext, extended);
    } else {
      return Response.status(Response.Status.NOT_FOUND).entity("Hive Query with id '" + id + "' not found").build();
    }
  }

  /**
   * Gets single query with the given hiveQueryId for the current user
   */
  @GET
  @Produces(MediaType.APPLICATION_JSON)
  @Path("/query")
  public Response getOneByHiveQueryId(@QueryParam("queryId") String queryId, @QueryParam("extended") boolean extended,
      @Context SecurityContext securityContext) {
    if (StringUtils.isEmpty(queryId)) {
      return Response.status(Response.Status.BAD_REQUEST).entity("Query parameter 'queryId' is required.").build();
    }
    Optional<HiveQueryBasicInfo> hiveQuery = hiveQueryRepo.findByHiveQueryId(queryId);
    if (hiveQuery.isPresent()) {
      return getForHiveQuery(hiveQuery.get(), securityContext, extended);
    } else {
      return Response.status(Response.Status.NOT_FOUND).entity("Hive Query with query id '" + queryId + "' not found").build();
    }
  }

  /**
   * Gets a single dag info
   */
  @GET
  @Consumes(MediaType.APPLICATION_JSON)
  @Produces(MediaType.APPLICATION_JSON)
  @Path("/vertices/{id}")
  public Response getOneVertex(@PathParam("id") Long id) {
    Optional<VertexInfo> queries = vertexInfoService.findOne(id);
    if(queries.isPresent()) {
      return Response.ok(Collections.singletonMap("vertex", queries.get())).build();
    } else {
      return Response.status(Response.Status.NOT_FOUND).entity("Dag Information with id '" + id + "' not found").build();
    }
  }

  /**
   * Gets a single dag info by dagId
   */
  @GET
  @Consumes(MediaType.APPLICATION_JSON)
  @Produces(MediaType.APPLICATION_JSON)
  @Path("/vertices")
  public Response getVertexByVertexId(@QueryParam("vertexId") String id, @QueryParam("dagId") String dagId) {
    if (StringUtils.isEmpty(id) && StringUtils.isEmpty(dagId)) {
      return Response.status(Response.Status.BAD_REQUEST).entity("Query parameter 'vertexId' or 'dagId' is required.").build();
    }

    Map<String, Object> response = new HashMap<>();
    if (!StringUtils.isEmpty(id)) {
      Optional<VertexInfo> queries = vertexInfoService.findByVertexId(id);
      if(queries.isPresent()) {
          response.put("vertex", queries);
      } else {
          return Response.status(Response.Status.NOT_FOUND).entity("Vertex Information with id '" + id + "' not found").build();
      }
    } else {
      Collection<VertexInfo> vertices = vertexInfoService.findAllByDagId(dagId);
      response.put("vertices", vertices);
    }
    return Response.ok(response).build();
  }
}
