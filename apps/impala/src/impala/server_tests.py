#!/usr/bin/env python
# -*- coding: utf-8 -*-
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

import logging
import sys

from nose.tools import assert_equal, assert_not_equal, assert_true, assert_false

from desktop.lib.django_test_util import make_logged_in_client
from useradmin.models import User

from impala.server import ImpalaDaemonApi

if sys.version_info[0] > 2:
  from unittest.mock import patch, Mock, MagicMock
else:
  from mock import patch, Mock, MagicMock


LOG = logging.getLogger(__name__)


class TestImpalaDaemonApi():

  def setUp(self):
    self.client = make_logged_in_client(username="test", groupname="default", recreate=True, is_superuser=False)
    self.user = User.objects.get(username="test")

  def test_digest_auth(self):

    with patch('impala.server.DAEMON_API_USERNAME.get') as DAEMON_API_USERNAME_get:
      with patch('impala.server.DAEMON_API_PASSWORD.get') as DAEMON_API_PASSWORD_get:
        with patch('impala.server.HttpClient') as HttpClient:
          DAEMON_API_USERNAME_get.return_value = 'impala'
          DAEMON_API_PASSWORD_get.return_value = 'impala'

          server = ImpalaDaemonApi('localhost')

          server._client.set_digest_auth.assert_called()
          server._client.set_kerberos_auth().assert_not_called()

    with patch('impala.server.DAEMON_API_USERNAME.get') as DAEMON_API_USERNAME_get:
      with patch('impala.server.DAEMON_API_PASSWORD.get') as DAEMON_API_PASSWORD_get:
        with patch('impala.server.HttpClient') as HttpClient:
          DAEMON_API_USERNAME_get.return_value = None
          DAEMON_API_PASSWORD_get.return_value = 'impala'

          server = ImpalaDaemonApi('localhost')

          server._client.set_digest_auth.assert_not_called()
          server._client.set_kerberos_auth().assert_not_called()
