// Licensed to Cloudera, Inc. under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  Cloudera, Inc. licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

const fs = require('fs');
const CleanWebpackPlugin = require('clean-webpack-plugin');
const {
  BUNDLES,
  getPluginConfig,
  splitChunksName
} = require('./desktop/core/src/desktop/js/webpack/configUtils');

process.traceDeprecation = true;
const config = {
  devtool: false,
  entry: {
    hue: { import: './desktop/core/src/desktop/js/hue.js' },
    editor: { import: './desktop/core/src/desktop/js/apps/editor/app.js', dependOn: 'hue' },
    notebook: { import: './desktop/core/src/desktop/js/apps/notebook/app.js', dependOn: 'hue' },
    tableBrowser: {
      import: './desktop/core/src/desktop/js/apps/tableBrowser/app.js',
      dependOn: 'hue'
    },
    jobBrowser: { import: './desktop/core/src/desktop/js/apps/jobBrowser/app.js', dependOn: 'hue' }
  },
  mode: 'development',
  module: {
    rules: [
      {
        test: /\.vue$/,
        use: 'vue-loader'
      },
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        loader: 'babel-loader'
      },
      { test: /\.js$/, use: ['source-map-loader'], enforce: 'pre' },
      {
        test: /\.(html)$/,
        use: [{ loader: 'html', options: { interpolater: true, removeComments: false } }]
      },
      { test: /\.less$/, use: ['style-loader', 'css-loader', 'less-loader'] },
      { test: /\.s[ac]ss$/, use: ['style-loader', 'css-loader', 'sass-loader'] },
      { test: /\.css$/, use: ['style-loader', 'css-loader'] },
      { test: /\.(woff2?|ttf|eot|svg)$/, use: ['file-loader'] },
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: ['babel-loader']
      }
    ]
  },
  optimization: {
    //minimize: true,
    minimize: false,
    splitChunks: {
      chunks: 'all',
      name: splitChunksName,
      maxSize: 1000000,
      hidePathInfo: true
    }
  },
  output: {
    path: __dirname + '/desktop/core/src/desktop/static/desktop/js/bundles/hue',
    filename: '[name]-bundle-[fullhash].js',
    chunkFilename: '[name]-chunk-[fullhash].js',
    clean: true
  },
  performance: {
    maxEntrypointSize: 400 * 1024, // 400kb
    maxAssetSize: 400 * 1024 // 400kb
  },
  plugins: getPluginConfig(BUNDLES.HUE).concat([
    new CleanWebpackPlugin([`${__dirname}/desktop/core/src/desktop/static/desktop/js/bundles/hue`])
  ]),
  resolve: {
    extensions: ['.json', '.jsx', '.js', '.tsx', '.ts', '.vue'],
    modules: ['node_modules', 'js'],
    alias: {
      bootstrap: __dirname + '/node_modules/bootstrap-2.3.2/js',
      vue$: __dirname + '/node_modules/vue/dist/vue.esm-browser.prod.js'
    }
  }
};

// To customize build configurations
const EXTEND_CONFIG_FILE = './webpack.config.extend.js';
if (fs.existsSync(EXTEND_CONFIG_FILE)) {
  const endedConfig = require(EXTEND_CONFIG_FILE);
  endedConfig(config);
  console.info('Webpack extended!');
}

module.exports = config;
