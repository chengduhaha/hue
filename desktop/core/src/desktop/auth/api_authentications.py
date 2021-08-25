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

import logging
import requests
import jwt
import json

from cryptography.hazmat.primitives import serialization
from rest_framework import authentication, exceptions

from desktop.auth.backend import find_or_create_user, ensure_has_a_group, rewrite_user
from desktop.conf import ENABLE_ORGANIZATIONS, AUTH

from useradmin.models import User

LOG = logging.getLogger(__name__)


class JwtAuthentication(authentication.BaseAuthentication):

  def authenticate(self, request):
    authorization_header = request.META.get('HTTP_AUTHORIZATION')

    if not authorization_header:
      LOG.debug('JwtAuthentication: no authorization header from %s' % request.path)
      return None

    header, access_token = authorization_header.split(' ')

    if header != 'Bearer':
      LOG.debug('JwtAuthentication: no Bearer header from %s' % request.path)
      return None

    if not access_token:
      LOG.debug('JwtAuthentication: no Bearer value from %s' % request.path)
      return None

    LOG.debug('JwtAuthentication: got access token from %s: %s' % (request.path, access_token))

    public_key_pem = ''
    if AUTH.JWT.VERIFY.get():
      public_key_pem = self._handle_public_key(access_token)

    try:
      payload = jwt.decode(
        access_token,
        public_key_pem,
        algorithms=["RS256"],
        verify=AUTH.JWT.VERIFY.get()
      )
    except jwt.DecodeError:
      raise exceptions.AuthenticationFailed('JwtAuthentication: Invalid token')
    except jwt.ExpiredSignatureError:
      raise exceptions.AuthenticationFailed('JwtAuthentication: Token expired')
    except Exception as e:
      raise exceptions.AuthenticationFailed(e)
    
    if payload.get('user') is None:
      LOG.debug('JwtAuthentication: no user ID in token')
      return None

    LOG.debug('JwtAuthentication: got user ID %s and tenant ID %s' % (payload.get('user'), payload.get('tenantId')))

    user = find_or_create_user(payload.get('user'), is_superuser=False)
    ensure_has_a_group(user)
    user = rewrite_user(user)

    # Persist the token (to reuse for communicating with external services as the user, e.g. Impala)
    if ENABLE_ORGANIZATIONS.get():
      user.token = access_token
    else:
      user.profile.update_data({'jwt_access_token': access_token})
      user.profile.save()

    return (user, None)

  def _handle_public_key(self, access_token):
    token_metadata = jwt.get_unverified_header(access_token)
    headers = {'kid': token_metadata.get('kid', {})} 

    if AUTH.JWT.KEY_SERVER_URL.get():
      jwk = requests.get(AUTH.JWT.KEY_SERVER_URL.get(), headers=headers)

      if jwk.get('keys'):
        public_key = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(jwk["keys"][0])).public_key()
        public_key_pem = public_key.public_bytes(encoding=serialization.Encoding.PEM, format=serialization.PublicFormat.SubjectPublicKeyInfo)

        return public_key_pem


class DummyCustomAuthentication(authentication.BaseAuthentication):
  """
  Only for local development environment does not have an external authentication service
  """

  def authenticate(self, request):
    LOG.debug('DummyCustomAuthentication: %s' % request.path)
    user = find_or_create_user(username='hue', password='hue')
    ensure_has_a_group(user)
    user = rewrite_user(user)
    user.is_active = True

    return (user, None)
