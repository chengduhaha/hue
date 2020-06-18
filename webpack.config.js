const webpack = require('webpack');
const BundleTracker = require('webpack-bundle-tracker');
const fs = require('fs');
const CleanWebpackPlugin = require('clean-webpack-plugin');
const CleanObsoleteChunks = require('webpack-clean-obsolete-chunks');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
const { VueLoaderPlugin } = require('vue-loader');

const path = require('path');
const each = require('lodash/fp/each');

// Vue generates absolute paths in the .js.map files for vue-hot-reload-api, this replaces it
// with a relative path.
class RemoveVueAbsolutePathFromMapPlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tapAsync(
      'RemoveVueAbsolutePathFromMapPlugin',
      (compilation, callback) => {
        compilation.chunks.forEach(chunk => {
          chunk.files.forEach(filename => {
            if (/\.js\.map$/.test(filename)) {
              const source = compilation.assets[filename].source();
              if (/"[^"]+\/node_modules\/vue-hot-reload-api/.test(source)) {
                const actualFilename = filename.split('/').pop();
                const outputFilename = compilation.outputOptions.path + '/' + actualFilename;
                const cleanSource = source.replace(
                  /"[^"]+\/node_modules\/vue-hot-reload-api/gi,
                  '"../../../../../../../../node_modules/vue-hot-reload-api'
                );
                fs.writeFileSync(outputFilename, cleanSource);
              }
            }
          });
        });
        callback();
      }
    );
  }
}

// https://github.com/ezhome/webpack-bundle-tracker/issues/25
class RelativeBundleTracker extends BundleTracker {
  convertPathChunks(chunks) {
    each(
      each(chunk => {
        chunk.path = path.relative(this.options.path, chunk.path);
      })
    )(chunks);
  }
  writeOutput(compiler, contents) {
    if (contents.status === 'done') {
      this.convertPathChunks(contents.chunks);
    }

    super.writeOutput(compiler, contents);
  }
}

module.exports = {
  devtool: false,
  mode: 'development',
  performance: {
    maxEntrypointSize: 400 * 1024, // 400kb
    maxAssetSize: 400 * 1024 // 400kb
  },
  resolve: {
    extensions: ['.json', '.jsx', '.js', '.tsx', '.ts', '.vue'],
    modules: ['node_modules', 'js'],
    alias: {
      bootstrap: __dirname + '/node_modules/bootstrap-2.3.2/js',
      vue$: __dirname + '/node_modules/vue/dist/vue.esm.browser.min.js'
    }
  },
  entry: {
    hue: ['./desktop/core/src/desktop/js/hue.js'],
    notebook: ['./desktop/core/src/desktop/js/apps/notebook/app.js'],
    tableBrowser: ['./desktop/core/src/desktop/js/apps/tableBrowser/app.js'],
    jobBrowser: ['./desktop/core/src/desktop/js/apps/jobBrowser/app.js']
  },
  optimization: {
    //minimize: true,
    minimize: false,
    splitChunks: {
      chunks: 'all',
      automaticNameMaxLength: 90
    },
    runtimeChunk: {
      name: 'hue'
    }
  },
  output: {
    path: __dirname + '/desktop/core/src/desktop/static/desktop/js/bundles/hue',
    filename: '[name]-bundle-[hash].js',
    chunkFilename: '[name]-chunk-[hash].js'
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        loader: 'babel-loader'
      },
      { test: /\.js$/, use: ['source-map-loader'], enforce: 'pre' },
      { test: /\.(html)$/, loader: 'html?interpolate&removeComments=false' },
      { test: /\.less$/, loader: 'style-loader!css-loader!less-loader' },
      { test: /\.css$/, loader: 'style-loader!css-loader' },
      { test: /\.(woff2?|ttf|eot|svg)$/, loader: 'file-loader' },
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        loader: 'babel-loader'
      },
      {
        test: /\.vue$/,
        loader: 'vue-loader',
        options: {
          loaders: {
            less: ['vue-style-loader', 'css-loader', 'less-loader']
          }
        }
      }
    ]
  },

  plugins: [
    // new BundleAnalyzerPlugin({ analyzerPort: 9000 }),
    new CleanObsoleteChunks(),
    new webpack.SourceMapDevToolPlugin({
      filename: 'hue/[file].map',
      publicPath: '/static/desktop/js/bundles/hue/',
      fileContext: 'public'
    }),
    new CleanWebpackPlugin([__dirname + '/desktop/core/src/desktop/static/desktop/js/bundles/hue']),
    new RelativeBundleTracker({ path: '.', filename: 'webpack-stats.json' }),
    new webpack.BannerPlugin(
      '\nLicensed to Cloudera, Inc. under one\nor more contributor license agreements.  See the NOTICE file\ndistributed with this work for additional information\nregarding copyright ownership.  Cloudera, Inc. licenses this file\nto you under the Apache License, Version 2.0 (the\n"License"); you may not use this file except in compliance\nwith the License.  You may obtain a copy of the License at\n\nhttp://www.apache.org/licenses/LICENSE-2.0\n\nUnless required by applicable law or agreed to in writing, software\ndistributed under the License is distributed on an "AS IS" BASIS,\nWITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.\nSee the License for the specific language governing permissions and\nlimitations under the License.\n'
    ),
    new VueLoaderPlugin(),
    new RemoveVueAbsolutePathFromMapPlugin()
  ]
};
