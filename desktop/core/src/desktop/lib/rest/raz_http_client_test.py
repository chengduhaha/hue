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

from nose.tools import assert_equal, assert_raises
from unittest.mock import patch, Mock

from desktop.lib.rest.raz_http_client import RazHttpClient
from desktop.lib.exceptions_renderable import PopupException

from hadoop.fs.exceptions import WebHdfsException


class TestRazHttpClient():

  def test_get_file(self):
    with patch('desktop.lib.rest.raz_http_client.AdlsRazClient.get_url') as raz_get_url:
      with patch('desktop.lib.rest.raz_http_client.HttpClient.execute') as raz_http_execute:

        raz_get_url.return_value = {
          'token': 'sv=2014-02-14&sr=b&sig=pJL%2FWyed41tptiwBM5ymYre4qF8wzrO05tS5MCjkutc%3D' \
            '&st=2015-01-02T01%3A40%3A51Z&se=2015-01-02T02%3A00%3A51Z&sp=r'
        }
        raz_http_execute.return_value = 'my_file_content'

        client = RazHttpClient(username='test', base_url='https://gethue.dfs.core.windows.net')
        f = client.execute(http_method='GET', path='/gethue/data/customer.csv', params={'action': 'getStatus'})

        url = 'https://gethue.dfs.core.windows.net/gethue/data/customer.csv?action=getStatus'
        assert_equal('my_file_content', f)
        raz_get_url.assert_called_with(action='GET', path=url, headers=None)
        raz_http_execute.assert_called_with(
            http_method='GET',
            path='/gethue/data/customer.csv?action=getStatus&sv=2014-02-14&sr=b&sig=pJL%2FWyed41tptiwBM5ymYre4qF8wzrO05tS5MCjkutc%3D' \
              '&st=2015-01-02T01%3A40%3A51Z&se=2015-01-02T02%3A00%3A51Z&sp=r',
            data=None,
            headers=None,
            allow_redirects=False,
            urlencode=False,
            files=None,
            stream=False,
            clear_cookies=False,
            timeout=120
        )

        # Check for file path having whitespaces
        f = client.execute(http_method='GET', path='/gethue/data/banks (1).csv', params={'action': 'getStatus'})

        url = 'https://gethue.dfs.core.windows.net/gethue/data/banks%20%281%29.csv?action=getStatus'
        assert_equal('my_file_content', f)
        raz_get_url.assert_called_with(action='GET', path=url, headers=None)
        raz_http_execute.assert_called_with(
            http_method='GET',
            path='/gethue/data/banks%20%281%29.csv?action=getStatus&sv=2014-02-14&sr=b&' \
              'sig=pJL%2FWyed41tptiwBM5ymYre4qF8wzrO05tS5MCjkutc%3D&st=2015-01-02T01%3A40%3A51Z&se=2015-01-02T02%3A00%3A51Z&sp=r',
            data=None,
            headers=None,
            allow_redirects=False,
            urlencode=False,
            files=None,
            stream=False,
            clear_cookies=False,
            timeout=120
        )


  def test_directory_paths(self):
    with patch('desktop.lib.rest.raz_http_client.AdlsRazClient.get_url') as raz_get_url:
      with patch('desktop.lib.rest.raz_http_client.HttpClient.execute') as raz_http_execute:
        raz_get_url.return_value = {
          'token': 'sv=2014-02-14&sr=b&sig=pJL%2FWyed41tptiwBM5ymYre4qF8wzrO05tS5MCjkutc%3D' \
            '&st=2015-01-02T01%3A40%3A51Z&se=2015-01-02T02%3A00%3A51Z&sp=r'
        }
        client = RazHttpClient(username='test', base_url='https://gethue.dfs.core.windows.net')

        # List call for non-ascii directory name (/user/Tжейкоб)
        params = {'directory': 'user/T\u0436\u0435\u0438\u0306\u043a\u043e\u0431', 'resource': 'filesystem'}

        f = client.execute(
          http_method='GET',
          path='/test',
          params=params
        )
        url = 'https://gethue.dfs.core.windows.net/test?directory=user/T%D0%B6%D0%B5%D0%B8%CC%86%D0%BA%D0%BE%D0%B1&resource=filesystem'

        raz_get_url.assert_called_with(action='GET', path=url, headers=None)
        raz_http_execute.assert_called_with(
            http_method='GET',
            path='/test?directory=user/T%D0%B6%D0%B5%D0%B8%CC%86%D0%BA%D0%BE%D0%B1&resource=filesystem&sv=2014-02-14&' \
              'sr=b&sig=pJL%2FWyed41tptiwBM5ymYre4qF8wzrO05tS5MCjkutc%3D&st=2015-01-02T01%3A40%3A51Z&se=2015-01-02T02%3A00%3A51Z&sp=r',
            data=None,
            headers=None,
            allow_redirects=False,
            urlencode=False,
            files=None,
            stream=False,
            clear_cookies=False,
            timeout=120
        )

        # List call for directory name having whitespaces (/user/test dir)
        f = client.execute(http_method='GET', path='/test', params={'directory': 'user/test user', 'resource': 'filesystem'})
        url = 'https://gethue.dfs.core.windows.net/test?directory=user/test%20user&resource=filesystem'

        raz_get_url.assert_called_with(action='GET', path=url, headers=None)
        raz_http_execute.assert_called_with(
            http_method='GET',
            path='/test?directory=user/test%20user&resource=filesystem&sv=2014-02-14&' \
              'sr=b&sig=pJL%2FWyed41tptiwBM5ymYre4qF8wzrO05tS5MCjkutc%3D&st=2015-01-02T01%3A40%3A51Z&se=2015-01-02T02%3A00%3A51Z&sp=r',
            data=None,
            headers=None,
            allow_redirects=False,
            urlencode=False,
            files=None,
            stream=False,
            clear_cookies=False,
            timeout=120
        )

        # List call for directory name having %20 like characters (/user/ab%20cd)
        f = client.execute(http_method='GET', path='/test', params={'directory': 'user/ab%20cd', 'resource': 'filesystem'})
        url = 'https://gethue.dfs.core.windows.net/test?directory=user/ab%2520cd&resource=filesystem'

        raz_get_url.assert_called_with(action='GET', path=url, headers=None)
        raz_http_execute.assert_called_with(
            http_method='GET',
            path='/test?directory=user/ab%2520cd&resource=filesystem&sv=2014-02-14&' \
              'sr=b&sig=pJL%2FWyed41tptiwBM5ymYre4qF8wzrO05tS5MCjkutc%3D&st=2015-01-02T01%3A40%3A51Z&se=2015-01-02T02%3A00%3A51Z&sp=r',
            data=None,
            headers=None,
            allow_redirects=False,
            urlencode=False,
            files=None,
            stream=False,
            clear_cookies=False,
            timeout=120
        )

        # List call for directory name having objects greater than 5000 and having continuation token param
        f = client.execute(
          http_method='GET',
          path='/test',
          params={
            'directory': 'user/test-dir',
            'resource': 'filesystem',
            'continuation': 'VBbzu86Hto/ksAkYKRgOZmlsZV8xNDQ5OC5jc3YWhK6wsrzcudoDGAAWiOHZ1/ivtdoDOAAAAA=='
          }
        )
        url = 'https://gethue.dfs.core.windows.net/test?directory=user/test-dir&resource=filesystem&' \
              'continuation=VBbzu86Hto/ksAkYKRgOZmlsZV8xNDQ5OC5jc3YWhK6wsrzcudoDGAAWiOHZ1/ivtdoDOAAAAA%3D%3D'

        raz_get_url.assert_called_with(action='GET', path=url, headers=None)
        raz_http_execute.assert_called_with(
            http_method='GET',
            path='/test?directory=user/test-dir&resource=filesystem&' \
              'continuation=VBbzu86Hto/ksAkYKRgOZmlsZV8xNDQ5OC5jc3YWhK6wsrzcudoDGAAWiOHZ1/ivtdoDOAAAAA%3D%3D&sv=2014-02-14&sr=b&' \
              'sig=pJL%2FWyed41tptiwBM5ymYre4qF8wzrO05tS5MCjkutc%3D&st=2015-01-02T01%3A40%3A51Z&se=2015-01-02T02%3A00%3A51Z&sp=r',
            data=None,
            headers=None,
            allow_redirects=False,
            urlencode=False,
            files=None,
            stream=False,
            clear_cookies=False,
            timeout=120
        )

        # List call for testdir~@$&()*!+=; directory name (/user/testdir~@$&()*!+=;)
        f = client.execute(http_method='GET', path='/test', params={'directory': 'user/testdir~@$&()*!+=;', 'resource': 'filesystem'})
        url = 'https://gethue.dfs.core.windows.net/test?directory=user/testdir~%40%24%26%28%29%2A%21%2B%3D%3B&resource=filesystem'

        raz_get_url.assert_called_with(action='GET', path=url, headers=None)
        raz_http_execute.assert_called_with(
            http_method='GET',
            path='/test?directory=user/testdir~%40%24%26%28%29%2A%21%2B%3D%3B&resource=filesystem&sv=2014-02-14&' \
              'sr=b&sig=pJL%2FWyed41tptiwBM5ymYre4qF8wzrO05tS5MCjkutc%3D&st=2015-01-02T01%3A40%3A51Z&se=2015-01-02T02%3A00%3A51Z&sp=r',
            data=None,
            headers=None,
            allow_redirects=False,
            urlencode=False,
            files=None,
            stream=False,
            clear_cookies=False,
            timeout=120
        )


  def test_root_path_stats(self):
    with patch('desktop.lib.rest.raz_http_client.AdlsRazClient.get_url') as raz_get_url:
      with patch('desktop.lib.rest.raz_http_client.HttpClient.execute') as raz_http_execute:

        raz_get_url.return_value = {
          'token': 'sv=2014-02-14&sr=b&sig=pJL%2FWyed41tptiwBM5ymYre4qF8wzrO05tS5MCjkutc%3D' \
            '&st=2015-01-02T01%3A40%3A51Z&se=2015-01-02T02%3A00%3A51Z&sp=r'
        }

        client = RazHttpClient(username='test', base_url='https://gethue.dfs.core.windows.net')
        f = client.execute(http_method='HEAD', path='/gethue', params={'action': 'getAccessControl'})
        url = 'https://gethue.dfs.core.windows.net/gethue/?action=getAccessControl'

        raz_get_url.assert_called_with(action='HEAD', path=url, headers=None)
        raz_http_execute.assert_called_with(
            http_method='HEAD',
            path='/gethue/?action=getAccessControl&sv=2014-02-14&sr=b&sig=pJL%2FWyed41tptiwBM5ymYre4qF8wzrO05tS5MCjkutc%3D' \
              '&st=2015-01-02T01%3A40%3A51Z&se=2015-01-02T02%3A00%3A51Z&sp=r',
            data=None,
            headers=None,
            allow_redirects=False,
            urlencode=False,
            files=None,
            stream=False,
            clear_cookies=False,
            timeout=120
        )


  def test_retry_operations(self):
    with patch('desktop.lib.rest.raz_http_client.AdlsRazClient.get_url') as raz_get_url:
      with patch('desktop.lib.rest.raz_http_client.HttpClient.execute') as raz_http_execute:

        raz_get_url.return_value = {
          'token': 'sv=2014-02-14&sr=b&sig=pJL%2FWyed41tptiwBM5ymYre4qF8wzrO05tS5MCjkutc%3D' \
            '&st=2015-01-02T01%3A40%3A51Z&se=2015-01-02T02%3A00%3A51Z&sp=r'
        }
        raz_http_execute.side_effect = WebHdfsException(Mock(response=Mock(status_code=403, text='Signature Mismatch')))

        client = RazHttpClient(username='test', base_url='https://gethue.dfs.core.windows.net')
        response = client.execute(http_method='HEAD', path='/gethue/user/demo', params={'action': 'getStatus'})
        url = 'https://gethue.dfs.core.windows.net/gethue/user/demo?action=getStatus'

        raz_get_url.assert_called_with(action='HEAD', path=url, headers=None)
        # Although we are mocking that both times ABFS sends 403 exception but still it retries only twice as per expectation.
        assert_equal(raz_http_execute.call_count, 2)

        # When ABFS raises exception with code other than 403.
        raz_http_execute.side_effect = WebHdfsException(Mock(response=Mock(status_code=404, text='Error resource not found')))
        client = RazHttpClient(username='test', base_url='https://gethue.dfs.core.windows.net')
        url = 'https://gethue.dfs.core.windows.net/gethue/user/demo?action=getStatus'

        # Exception got re-raised for later use.
        assert_raises(WebHdfsException, client.execute, http_method='HEAD', path='/gethue/user/demo', params={'action': 'getStatus'})
        raz_get_url.assert_called_with(action='HEAD', path=url, headers=None)


  def test_handle_raz_adls_response(self):
    with patch('desktop.lib.rest.raz_http_client.AdlsRazClient.get_url') as raz_get_url:

      # When RAZ denies request and sends no response
      raz_get_url.return_value = None
      client = RazHttpClient(username='test', base_url='https://gethue.blob.core.windows.net')

      assert_raises(PopupException, client.execute, http_method='GET', path='/gethue/data/customer.csv', params={'action': 'getStatus'})

      # When no SAS token in response
      raz_get_url.return_value = {}
      client = RazHttpClient(username='test', base_url='https://gethue.blob.core.windows.net')

      assert_raises(PopupException, client.execute, http_method='GET', path='/gethue/data/customer.csv', params={'action': 'getStatus'})
