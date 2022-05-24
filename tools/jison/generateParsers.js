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

/* eslint-disable no-restricted-syntax */

const cli = require('jison/lib/cli');
const fs = require('fs');
const fsExtra = require('fs-extra');

const LICENSE =
  '// Licensed to Cloudera, Inc. under one\n' +
  '// or more contributor license agreements.  See the NOTICE file\n' +
  '// distributed with this work for additional information\n' +
  '// regarding copyright ownership.  Cloudera, Inc. licenses this file\n' +
  '// to you under the Apache License, Version 2.0 (the\n' +
  '// "License"); you may not use this file except in compliance\n' +
  '// with the License.  You may obtain a copy of the License at\n' +
  '//\n' +
  '//     http://www.apache.org/licenses/LICENSE-2.0\n' +
  '//\n' +
  '// Unless required by applicable law or agreed to in writing, software\n' +
  '// distributed under the License is distributed on an "AS IS" BASIS,\n' +
  '// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.\n' +
  '// See the License for the specific language governing permissions and\n' +
  '// limitations under the License.\n';

const SQL_STATEMENTS_PARSER_JSDOC =
  '/**\n' +
  ' * @param {string} input\n' +
  ' *\n' +
  ' * @return {SqlStatementsParserResult}\n' +
  ' */\n';

const OUTPUT_FOLDER = '../../desktop/core/src/desktop/js/parse/';
const PARSER_FOLDER = `${OUTPUT_FOLDER}sql/`;
const JISON_FOLDER = `${OUTPUT_FOLDER}jison/`;

const parserDefinitions = {
  globalSearchParser: {
    sources: ['globalSearchParser.jison'],
    target: 'globalSearchParser.jison',
    outputFolder: OUTPUT_FOLDER,
    afterParse: contents =>
      new Promise(resolve => {
        resolve(
          LICENSE +
            contents.replace(
              'var globalSearchParser = ',
              "import SqlParseSupport from 'parse/sqlParseSupport';\n\nvar globalSearchParser = "
            ) +
            '\nexport default globalSearchParser;\n'
        );
      })
  },
  solrFormulaParser: {
    sources: ['solrFormulaParser.jison'],
    target: 'solrFormulaParser.jison',
    outputFolder: OUTPUT_FOLDER,
    afterParse: contents =>
      new Promise(resolve => {
        resolve(LICENSE + contents + 'export default solrFormulaParser;\n');
      })
  },
  solrQueryParser: {
    sources: ['solrQueryParser.jison'],
    target: 'solrQueryParser.jison',
    outputFolder: OUTPUT_FOLDER,
    afterParse: contents =>
      new Promise(resolve => {
        resolve(LICENSE + contents + 'export default solrQueryParser;\n');
      })
  },
  sqlStatementsParser: {
    sources: ['sqlStatementsParser.jison'],
    target: 'sqlStatementsParser.jison',
    outputFolder: OUTPUT_FOLDER,
    afterParse: contents =>
      new Promise(resolve => {
        resolve(
          LICENSE +
            contents.replace(
              'parse: function parse',
              SQL_STATEMENTS_PARSER_JSDOC + 'parse: function parse'
            ) +
            'export default sqlStatementsParser;\n'
        );
      })
  },
  hplsqlStatementsParser: {
    sources: ['hplsqlStatementsParser.jison'],
    target: 'hplsqlStatementsParser.jison',
    outputFolder: OUTPUT_FOLDER,
    afterParse: contents =>
      new Promise(resolve => {
        resolve(
          LICENSE +
            contents.replace(
              'parse: function parse',
              SQL_STATEMENTS_PARSER_JSDOC + 'parse: function parse'
            ) +
            'export default hplsqlStatementsParser;\n'
        );
      })
  }
};

const mkdir = path =>
  new Promise((resolve, reject) => {
    if (fs.existsSync(path)) {
      resolve();
    } else {
      fs.mkdir(path, err => {
        if (err) {
          reject(err);
        }
        resolve();
      });
    }
  });

const readFile = path =>
  new Promise((resolve, reject) => {
    fs.readFile(path, (err, buf) => {
      if (err) {
        reject(err);
      }
      resolve(buf ? buf.toString() : '');
    });
  });

const writeFile = (path, contents) =>
  new Promise((resolve, reject) => {
    fsExtra.ensureFile(path).then(() => {
      fs.writeFile(path, contents, err => {
        if (err) {
          console.log(err);
          reject();
        }
        resolve();
      });
    });
  });

const copyFile = (source, destination, contentsCallback) =>
  new Promise((resolve, reject) => {
    readFile(source)
      .then(contents => {
        writeFile(destination, contentsCallback ? contentsCallback(contents) : contents)
          .then(resolve)
          .catch(reject);
      })
      .catch(reject);
  });

const deleteFile = path => {
  fs.unlinkSync(path);
};

const generateParser = parserName =>
  new Promise((resolve, reject) => {
    const parserConfig = parserDefinitions[parserName];

    const concatPromise = new Promise((resolve, reject) => {
      if (parserConfig.sources.length > 1 && parserConfig.target) {
        console.log('Concatenating files...');
        const promises = parserConfig.sources.map(fileName => readFile(JISON_FOLDER + fileName));

        Promise.all(promises)
          .then(contents => {
            writeFile(JISON_FOLDER + parserConfig.target, contents.join('')).then(() => {
              resolve(JISON_FOLDER + parserConfig.target);
            });
          })
          .catch(reject);
      } else if (parserConfig.sources.length === 1) {
        resolve(JISON_FOLDER + parserConfig.sources[0]);
      } else {
        reject('No jison source specified');
      }
    });

    concatPromise
      .then(targetPath => {
        const options = {
          file: targetPath,
          'module-type': 'js'
        };
        if (parserConfig.lexer) {
          options['lexfile'] = JISON_FOLDER + parserConfig.lexer;
        }

        console.log('Generating parser...');
        try {
          cli.main(options);
        } catch (err) {
          console.error('Failed calling jison cli');
          throw err;
        }
        if (parserConfig.sources.length > 1) {
          deleteFile(targetPath); // Remove concatenated file
        }
        console.log('Adjusting JS...');
        const generatedJsFileName = parserConfig.target
          .replace('.jison', '.js')
          .replace(/^.*\/([^/]+)$/, '$1');
        console.log(generatedJsFileName);
        readFile(generatedJsFileName)
          .then(contents => {
            parserConfig
              .afterParse(contents)
              .then(finalContents => {
                writeFile(parserConfig.outputFolder + generatedJsFileName, finalContents)
                  .then(() => {
                    deleteFile(generatedJsFileName);
                    resolve();
                  })
                  .catch(error => {
                    console.info(error);
                    reject();
                  });
              })
              .catch(reject);
          })
          .catch(reject);
      })
      .catch(reject);
  });

let parsersToGenerate = [];
const invalid = [];

let all = false;

const listDir = folder =>
  new Promise(resolve => {
    fs.readdir(folder, (err, files) => {
      resolve(files);
    });
  });

const addParserDefinition = (sources, dialect, autocomplete, lexer) => {
  const parserName = dialect + (autocomplete ? 'AutocompleteParser' : 'SyntaxParser');

  const parserDefinition = {
    sources: sources,
    lexer: 'sql/' + dialect + '/' + lexer,
    target: 'sql/' + dialect + '/' + parserName + '.jison',
    sqlParser: autocomplete ? 'AUTOCOMPLETE' : 'SYNTAX',
    outputFolder: OUTPUT_FOLDER + 'sql/' + dialect + '/',
    afterParse: contents =>
      new Promise(resolve => {
        resolve(
          LICENSE +
            contents
              .replace(
                'var ' + parserName + ' = ',
                "import SqlParseSupport from 'parse/sql/" +
                  dialect +
                  "/sqlParseSupport';\n\nvar " +
                  parserName +
                  ' = '
              )
              .replace(
                'loc: yyloc,',
                "loc: lexer.yylloc, ruleId: stack.slice(stack.length - 2, stack.length).join(''),"
              ) +
            '\nexport default ' +
            parserName +
            ';\n'
        );
      })
  };

  parserDefinitions[parserName] = parserDefinition;
};

const addParsersFromStructure = (structure, dialect) => {
  addParserDefinition(
    structure.autocomplete.map(source => 'sql/' + dialect + '/' + source),
    dialect,
    true,
    structure.lexer
  );
  addParserDefinition(
    structure.syntax.map(source => 'sql/' + dialect + '/' + source),
    dialect,
    false,
    structure.lexer
  );
};

const fileIsVisible = fileName => !fileName.startsWith('.');

const identifySqlParsers = () =>
  new Promise(resolve => {
    listDir(JISON_FOLDER + 'sql').then(files => {
      const promises = [];
      files.filter(fileIsVisible).forEach(folder => {
        promises.push(
          listDir(JISON_FOLDER + 'sql/' + folder).then(async jisonFiles => {
            if (jisonFiles.find(fileName => fileName === 'structure.json')) {
              const structure = JSON.parse(
                await readFile(JISON_FOLDER + 'sql/' + folder + '/structure.json')
              );
              addParsersFromStructure(structure, folder);
            } else {
              console.log(
                "Warn: Could not find 'structure.jisonlex' in " +
                  JISON_FOLDER +
                  'sql/' +
                  folder +
                  '/'
              );
            }
          })
        );
      });
      Promise.all(promises).then(resolve);
    });
  });

const copyTests = (source, target) =>
  new Promise((resolve, reject) => {
    const replaceRegexp = new RegExp(source + '(Autocomplete|Syntax)Parser', 'g');
    mkdir(PARSER_FOLDER + target)
      .then(() => {
        mkdir(PARSER_FOLDER + target + '/test')
          .then(() => {
            listDir(PARSER_FOLDER + source + '/test')
              .then(testFiles => {
                const copyPromises = [];
                testFiles.forEach(testFile => {
                  copyPromises.push(
                    copyFile(
                      PARSER_FOLDER + source + '/test/' + testFile,
                      PARSER_FOLDER + target + '/test/' + testFile.replace(source, target),
                      contents => contents.replace(replaceRegexp, target + '$1Parser')
                    )
                  );
                });
                Promise.all(copyPromises).then(resolve).catch(reject);
              })
              .catch(reject);
          })
          .catch(reject);
      })
      .catch(reject);
  });

const prepareForNewParser = () =>
  new Promise((resolve, reject) => {
    if (process.argv.length === 3 && process.argv[0] === '-new') {
      process.argv.shift();
      const source = process.argv.shift();
      const target = process.argv.shift();
      console.log("Generating new parser '" + target + "' based on '" + source + "'...");
      process.argv.push(target);

      if (
        !Object.keys(parserDefinitions).some(key => {
          if (key.indexOf(source) === 0) {
            copyTests(source, target)
              .then(() => {
                mkdir(JISON_FOLDER + 'sql/' + target)
                  .then(() => {
                    listDir(JISON_FOLDER + 'sql/' + source).then(files => {
                      const copyPromises = [];
                      files.forEach(file => {
                        // "file" can also be a subfolder with files in it
                        const fromPath = JISON_FOLDER + 'sql/' + source + '/' + file;
                        const toPath = JISON_FOLDER + 'sql/' + target + '/' + file;
                        copyPromises.push(fsExtra.copy(fromPath, toPath));
                      });
                      Promise.all(copyPromises).then(() => {
                        const autocompleteSources = [
                          'sql/' + target + '/autocomplete_header.jison'
                        ];
                        const syntaxSources = ['sql/' + target + '/syntax_header.jison'];

                        files.forEach(file => {
                          if (file.indexOf('sql_') === 0) {
                            autocompleteSources.push('sql/' + target + '/' + file);
                            syntaxSources.push('sql/' + target + '/' + file);
                          }
                        });
                        autocompleteSources.push('sql/' + target + '/autocomplete_footer.jison');
                        syntaxSources.push('sql/' + target + '/syntax_footer.jison');
                        mkdir(PARSER_FOLDER + target).then(() => {
                          copyFile(
                            PARSER_FOLDER + source + '/sqlParseSupport.js',
                            PARSER_FOLDER + target + '/sqlParseSupport.js',
                            contents =>
                              contents.replace(
                                /parser\.yy\.activeDialect = '[^']+';'/g,
                                "parser.yy.activeDialect = '" + target + "';"
                              )
                          ).then(() => {
                            identifySqlParsers().then(resolve).catch(reject);
                          });
                        });
                      });
                    });
                  })
                  .catch(err => {
                    console.log(err);
                  });
              })
              .catch(reject);
            return true;
          }
        })
      ) {
        reject("No existing parser found for '" + source + "'");
      }
    } else {
      resolve();
    }
  });

identifySqlParsers().then(() => {
  process.argv.shift();
  process.argv.shift();
  prepareForNewParser().then(() => {
    process.argv.forEach(arg => {
      if (arg === 'all') {
        all = true;
      } else if (parserDefinitions[arg]) {
        parsersToGenerate.push(arg);
      } else {
        let prefixFound = false;
        Object.keys(parserDefinitions).forEach(key => {
          if (key.indexOf(arg) === 0) {
            prefixFound = true;
            parsersToGenerate.push(key);
          }
        });
        if (!prefixFound) {
          invalid.push(arg);
        }
      }
    });

    if (all) {
      parsersToGenerate = Object.keys(parserDefinitions);
    }

    if (invalid.length) {
      console.log("No parser config found for: '" + invalid.join("', '") + "'");
      console.log(
        '\nPossible options are:\n  ' +
          ['all'].concat(Object.keys(parserDefinitions)).join('\n  ') +
          '\n'
      );
      return;
    }

    const parserCount = parsersToGenerate.length;
    let idx = 0;

    const generateRecursive = () => {
      idx++;
      if (parsersToGenerate.length) {
        const parserName = parsersToGenerate.pop();
        if (parserCount > 1) {
          console.log("Generating '" + parserName + "' (" + idx + '/' + parserCount + ')...');
        } else {
          console.log("Generating '" + parserName + "'...");
        }
        generateParser(parserName)
          .then(generateRecursive)
          .catch(error => {
            console.log(error);
            console.log('FAIL!');
          });
      }
    };
    generateRecursive();
  });
});

/* eslint-enable no-restricted-syntax */

module.exports = { LICENSE, PARSER_FOLDER };
