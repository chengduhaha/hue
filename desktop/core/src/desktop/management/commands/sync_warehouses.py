#!/usr/bin/env python
# Licensed to Cloudera, Inc. under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  Cloudera, Inc. licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# HUE_CONF_DIR=/etc/hue/conf HUE_IGNORE_PASSWORD_SCRIPT_ERRORS=1 /opt/hive/build/env/bin/hue sync_warehouses

from desktop.lib.connectors import models
from django.core.management.base import BaseCommand
from hadoop import confparse
import json
from kubernetes import client, config
import logging
import os
import re
import sys
from useradmin.models import update_app_permissions


LOG = logging.getLogger(__name__)

if (config.incluster_config.SERVICE_HOST_ENV_NAME in os.environ
    and config.incluster_config.SERVICE_PORT_ENV_NAME in os.environ):
  # We are running in a k8s environment and must use service account
  config.load_incluster_config()
else:
  # Try loading the default kubernetes config file. Intended for local dev
  config.load_kube_config()

core_v1 = client.CoreV1Api()
apps_v1 = client.AppsV1Api()

SERVER_HELP = r"""
  Sync up the desktop_connectors with the available hive and impala warehouses
"""


class Command(BaseCommand):
  def add_arguments(self, parser):
    pass

  def handle(self, *args, **options):
    sync_warehouses(args, options)

  def usage(self, subcommand):
    return SERVER_HELP


def sync_warehouses(args, options):
  (hives, impalas) = get_computes_from_k8s()

  (hive_warehouse, created) = models.Connector.objects.get_or_create(
    external_id="CDW_HIVE_WAREHOUSE",
    defaults={'name': 'Hive', 'description': 'CDW Hive Warehouse', 'dialect': 'hive', 'interface': 'multi-hs2-compute'})
  add_computes_to_warehouse(hive_warehouse, hives)

  (impala_warehouse, created) = models.Connector.objects.get_or_create(
    external_id="CDW_IMPALA_WAREHOUSE",
    defaults={'name': 'Impala', 'description': 'CDW Impala Warehouse', 'dialect': 'impala', 'interface': 'multi-hs2-compute'})
  add_computes_to_warehouse(impala_warehouse, impalas)

  update_app_permissions()

  LOG.info("Synced connectors")
  LOG.debug("Current connectors %s" % models.Connector.objects.all())


def add_computes_to_warehouse(warehouse, computes):
  for c in computes:
    c['parent'] = warehouse
    models.Connector.objects.update_or_create(external_id=c['external_id'], defaults=c)
  external_ids = [c['external_id'] for c in computes]
  models.Connector.objects.filter(parent=warehouse).exclude(external_id__in=external_ids).delete()


if __name__ == '__main__':
  args = sys.argv[1:]
  options = {}
  sync_warehouses(args, options)


def get_computes_from_k8s():
  catalogs = []
  hives = []
  impalas = []
  computes = {}

  for n in core_v1.list_namespace().items:
    namespace = n.metadata.name
    item = {
      'name': n.metadata.labels.get('displayname'),
      'description': '%s (%s)' % (n.metadata.labels.get('displayname'), n.metadata.name),
      'external_id': namespace,
      #'creation_timestamp': n.metadata.labels.get('creation_timestamp'),
    }

    if namespace.startswith('warehouse-'):
      catalogs.append(item)
    elif namespace.startswith('compute-'):
      hives.append(item)
      computes[namespace] = item
      update_hive_configs(namespace, item, 'hiveserver2-service.%s.svc.cluster.local' % namespace)
    elif namespace.startswith('impala-'):
      impalas.append(item)
      computes[namespace] = item
      populate_impala(namespace, item)

  return (hives, impalas)

def update_hive_configs(namespace, hive, host, port=80):
  hs2_stfs = apps_v1.read_namespaced_stateful_set('hiveserver2', namespace)

  hive_configs = core_v1.read_namespaced_config_map('hive-conf-hiveserver2', namespace)
  hive_site_data = confparse.ConfParse(hive_configs.data['hive-site.xml'])
  ldap_groups = hive_site_data.get('hive.server2.authentication.ldap.groupFilter', '')
  hive_metastore_uris = hive_site_data.get('hive.metastore.uris')

  settings = [
    {"name": "server_host", "value": host},
    {"name": "server_port", "value": port},
    {"name": "transport_mode", "value": 'http'},
    {"name": "http_url", "value": 'http://%s:%s/cliservice' % (host, port)},
    {"name": "is_llap", "value": False},
    {"name": "use_sasl", "value": True},
    {"name": "hive_metastore_uris", "value": hive_metastore_uris},
  ]

  hive.update({
    'dialect': 'hive',
    'interface': 'hiveserver2',
    'is_ready': bool(hs2_stfs.status.ready_replicas),
    'ldap_groups': ldap_groups.split(",") if ldap_groups else None,
    'settings': json.dumps(settings)
  })


def populate_impala(namespace, impala):
  deployments = apps_v1.list_namespaced_deployment(namespace).items
  stfs = apps_v1.list_namespaced_stateful_set(namespace).items
  catalogd_dep = next((d for d in deployments if d.metadata.labels['app'] == 'catalogd'), None)
  catalogd_stfs = next((s for s in stfs if s.metadata.labels['app'] == 'catalogd'), None)
  statestore_dep = next((d for d in deployments if d.metadata.labels['app'] == 'statestored'), None)
  admissiond_dep = next((d for d in deployments if d.metadata.labels['app'] == 'admissiond'), None)

  impala['is_ready'] = bool(((catalogd_dep and catalogd_dep.status.ready_replicas) or (
        catalogd_stfs and catalogd_stfs.status.ready_replicas))
                     and (statestore_dep and statestore_dep.status.ready_replicas)
                     and (admissiond_dep and admissiond_dep.status.ready_replicas))

  if not impala['is_ready']:
    LOG.info("Impala %s not ready" % namespace)

  impala_proxy = next((d for d in deployments if d.metadata.labels['app'] == 'impala-proxy'), None)
  if impala_proxy:
    update_impala_configs(namespace, impala, 'impala-proxy.%s.svc.cluster.local' % namespace, 25000)
  else:
    coordinator = next((s for s in stfs if s.metadata.labels['app'] == 'coordinator'), None)
    impala['is_ready'] = impala['is_ready'] and (coordinator and coordinator.status.ready_replicas)

    hs2_stfs = next((s for s in stfs if s.metadata.labels['app'] == 'hiveserver2'), None)
    if hs2_stfs:
      # Impala is running with UA
      impala['is_ready'] = impala['is_ready'] and hs2_stfs.status.ready_replicas
      update_hive_configs(namespace, impala, 'hiveserver2-service.%s.svc.cluster.local' % namespace)
    else:
      # Impala is not running with UA
      update_impala_configs(namespace, impala, 'coordinator.%s.svc.cluster.local' % namespace, 28000)

def update_impala_configs(namespace, impala, host, port):
  hive_configs = core_v1.read_namespaced_config_map('impala-coordinator-hive-conf', namespace)
  hive_site_data = confparse.ConfParse(hive_configs.data['hive-site.xml'])
  hive_metastore_uris = hive_site_data.get('hive.metastore.uris')

  impala_flag_file = core_v1.read_namespaced_config_map('impala-coordinator-flagfile', namespace)
  flag_file_data = impala_flag_file.data['flagfile']
  ldap_regex = r'--ldap_group_filter=(.*)'
  match = re.search(ldap_regex, flag_file_data)
  ldap_groups = match.group(1) if match and match.group(1) else ''

  settings = [
    {"name": "server_host", "value": host},
    {"name": "server_port", "value": port},
    {"name": "transport_mode", "value": 'http'},
    {"name": "http_url", "value": 'http://%s:%s/cliservice' % (host, port)},
    {"name": "impersonation_enabled", "value": False},
    {"name": "use_sasl", "value": False},
    {"name": "hive_metastore_uris", "value": hive_metastore_uris},
  ]

  impala.update({
    'dialect': 'impala',
    'interface': 'hiveserver2',
    'ldap_groups': ldap_groups.split(","),
    'settings': json.dumps(settings)
  })
