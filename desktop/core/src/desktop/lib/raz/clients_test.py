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

import unittest

from nose.plugins.skip import SkipTest
from nose.tools import assert_equal, assert_false, assert_true, assert_raises

from desktop.conf import RAZ
from desktop.lib.raz.clients import S3RazClient


class S3RazClientLiveTest(unittest.TestCase):

  @classmethod
  def setUpClass(cls):
    if not RAZ.IS_ENABLED.get():
      raise SkipTest

  def test_check_access_s3_list_buckets(self):

    url = S3RazClient().get_url()

    assert_true('Expires=' in url)


  def test_check_acccess_s3_list_file(self):
    # e.g. 'https://gethue-test.s3.amazonaws.com/data/query-hive-weblogs.csv?AWSAccessKeyId=AKIA23E77ZX2HVY76YGL&Signature=3lhK%2BwtQ9Q2u5VDIqb4MEpoY3X4%3D&Expires=1617207304'

    url = S3RazClient().get_url(bucket='gethue-test', path='/data/query-hive-weblogs.csv')

    assert_true('data/query-hive-weblogs.csv' in url)
    assert_true('AWSAccessKeyId=' in url)
    assert_true('Signature=' in url)
    assert_true('Expires=' in url)

    url = S3RazClient().get_url(bucket='gethue-test', path='/data/query-hive-weblogs.csv', perm='read', action='write')

    assert_true('data/query-hive-weblogs.csv' in url)
    assert_true('AWSAccessKeyId=' in url)
    assert_true('Signature=' in url)
    assert_true('Expires=' in url)

  def test_check_acccess_s3_list_file_no_access(self): pass
