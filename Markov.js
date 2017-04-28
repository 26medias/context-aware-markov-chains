const natural = require('natural');
const pstack = require('pstack');
const md5File = require('md5-file');
const NGrams = natural.NGrams;
const pos = require('pos');
const tbl = require('cli-table');
const seraph = require("seraph");
const Tagger = natural.BrillPOSTagger;
const tokenizer = require("node-tokenizer");
const wlist = require("./WeightedList");
const range = require('python-range');
const fs = require('fs');
const Promise = require('bluebird');

class Markov {
    constructor(options) {
        this.options = Object.assign({
            db: 'http://localhost:7473',
            name: 'dev',
            user: 'neo4j',
            pass: 'neo4j',
            depth: [1,3],
            weight: 1.2,
            depthWeight: 2,
            certainty: 1
        }, options);
    }

    tokenize(text) {
        let cues = ['?', '!', '.', ',', ':', ';', '\t', '\n', '\r'];
        let tokens = text.split(' ');

        if (this.options.debug) console.log('tokens', tokens);

        cues.forEach(cue => {
            tokens = tokens.map(token => {
                let parts = token.split(cue);
                let l = parts.length;

                if (l === 1) return token;

                let buffer = [];
                parts.forEach((part, i) => {
                    buffer.push(part);
                    if (i < l - 1) {
                        buffer.push(cue);
                    }
                });

                return buffer;
            });

            tokens = tokens.flatten();
            tokens = tokens.filter(item => item !== '');
            if (this.options.debug) console.log('tokens', tokens);
        });

        return tokens;
    }

    test() {
        let text = 'I would like to talk today about: how to develop a new foreign policy direction for our country? one that replaces! randomness with purpose, ideology with strategy, and chaos with peace.\n\nIt is time to shake the rust off of America\'s foreign policy. It\'s time to invite new voices and new visions into the fold.';
        let text2	= 'i started i did it , i was, oh, that first couple of weeks with illegal immigration and mexico and all of this stuff , right ? and all of a sudden , people are coming over , and i say the wall and now they\'re starting to look elsewhere for help . i started i did it , i was , oh , that first couple of weeks with illegal immigration';

        console.log(this.beautify(text2));
    }

    beautify(text) {
        text = text.replace(/\s(\.|,|:|;|!|\?)\s/gmi, (match, punc) => punc + ' ');
        text.replace(/(\.|!|\?|\n)(\s)([a-z])/gmi, (match, punc, space, letter) => punc + space + letter.toUpperCase());
        text = text.substr(0, 1).toUpperCase() + text.substr(1);
        
        return text;
    }

    test2() {       
        this.open(() => {
            this.graph.query('MATCH p=(x:`ngrams-trump` {gram:{x}})-[:then*1..50]->(y:`ngrams-trump` {gram:{y}}) RETURN p LIMIT 50', {x: 'world', y: 'trump'}, (err, result) => {
                if (err) throw err;
                if (result) {
                    result.forEach(item => {
                        let nodes = item.nodes.map(node => node.split('/').pop());

                        let stack = new pstack();
                        let grams = [];

                        nodes.forEach(node => {
                            stack.add(done => {
                                this.graph.read(node, (err, node) => {
                                    if (err) throw err;
                                    if (node) grams.push(node.gram);
                                    done();
                                });
                            });
                        });

                        stack.start(() => {
                            console.log("----------------------\n",grams.join(' '));
                        });
                        if (this.options.debug) console.log('nodes', nodes);
                    });
                }

                if (this.options.debug) console.log('result', result);
            });
        });

        return this;
    }

    open() {
        return new Promise((resolve, reject) => {
            this.graph = seraph({
                server: 'http://localhost:7474',
                user: this.options.user,
                pass: this.options.pass
            });

            this.graph.constraints.uniqueness.createIfNone(`ngrams-${this.options.name}`, 'gram', (err, constraint) => {
                if (err) {
                    reject(err);
                } else {
                    this.graph.constraints.uniqueness.createIfNone(`pos-${this.options.name}`, 'gram', (err, constraint) => {
                        let baseFolder = './node_modules/natural/lib/natural/brill_pos_tagger/data/English';
                        let rulesFile = `${baseFolder}/tr_from_posjs.txt`;
                        let lexiconFile = `${baseFolder}/lexicon_from_posjs.json`;
                        let defaultCategory = 'N';

                        let tagger = new Tagger(lexiconFile, rulesFile, defaultCategory, err => {
                            if (err) {
                                reject(err);
                            } else {
                                this.tagger = tagger;
                                resolve();
                            }
                        });
                    });
                }
            });
        });
    }

    read(filename, callback) {
        let start = new Date().getTime();

        this.open(() => {
            md5File(filename, (err, sum) => {
                /* if (this.data.docs[sum]) {
                    console.log(`Training already done on that document, on ${this.data.docs[sum]}`);
                    callback(this.data.grams);
                    return false;
                }*/
                
                fstool.file.read(filename, text => {
                    /* text = new pos.Lexer().lex(test);
                    let tokenizer = new natural.RegexpTokenizer({pattern: / /});
                    text = tokenizer.tokenize(text);*/
                    text = this.tokenize(text);
                    // console.log('text', text);

                    // Generate the n-grams.
                    let grams = {};
                    let unique = {};
                    let nodeIndex = {};

                    let stackNgram = new pstack({
                        progress: 'Reading the N-grams...',
                        reportInterval: 100,
                        batch: 10
                    });

                    let stackRel = new pstack({
                        progress:  'Mapping...',
                        reportInterval: 100
                    });

                    for (let depth of range(this.options.depth[0], this.options.depth[1]+ 1)) {
                        console.log(`Starting Depth ${depth}`);
                        console.log('Generating the ngrams.');

                        grams[depth] = NGrams.ngrams(text, depth);

                        console.log(`Stringification of ${grams[depth].length} ngrams`);

                        let ngramObj = {};

                        grams[depth].forEach(item => {
                            ngramObj[item.join('|')] = true;
                        });

                        let uniqueNgrams = Object.keys(ngramObj).length;

                        console.log('Graphing');

                        // Save the gram
                        for (let gram in ngramObj) {
                            let v = ngramObj[gram];
                            gram = gram.toLowerCase();
                            stackNgram.add(done => {
                                this.graph.save({gram, depth}, `ngrams-${this.options.name}`, (err, node) => {
                                    if (err) {
                                        this.graph.find({gram, depth}, false, `ngrams-${this.options.name}`, (err, response) => {
                                            if (err) throw err;
                                            if (response && response.length > 0) {
                                                nodeIndex[gram] = response[0].idl
                                                // console.log('Node:\t\t', '[found]');;
                                            }

                                            done();
                                        });
                                        return false;
                                    } else {
                                        // console.log('Node:\t\t', '[created]');
                                        nodeIndex[gram] = node.id;
                                        done();
                                    }
                                });
                            });
                        }

                        // Process the gram graph
                        for (let n in grams[depth]) {
                            if (n === 0) return false;

                            let current = grams[depth][n - 1].join('|').toLowerCase();
                            let next = grams[depth][n].slice(-1).join('').toLowerCase();

                            stackRel.add(done => {
                                // console.log(">> ",current,' >>> ',next, ' -> ', nodeIndex[current], ' >>> ', nodeIndex[next]);
                                this.graph.relationships(nodeIndex[current], 'out', 'then', (err, relationships) => {
                                    if (err) {
                                        // console.log('Relationship:\t', '[failed]');
                                        return false;
                                    } else {
                                        if (relationships) {
                                            // Look for the relationship
                                            let relationship = relationships.find(rel => rel.start == nodeIndex[current] && rel.send == nodeIndex[next]);

                                            if (relationship) {
                                                // Update the relationship weight
                                                relationship.properties.weight += 1;
                                                this.graph.rel.update(relationship, err => {
                                                    if (err) // console.log('Relationship:\t', '[failed]');
                                                    // console.log('Relationship:\t', '[updated]');
                                                    done();
                                                });
                                            } else {
                                                this.graph.relate(nodeIndex[current], 'then', nodeIndex[next], {weight: 1, ngrame: next, idx: nodeIndex[next]}, err => {
                                                    if (err); // console.log('Relationship:\t', '[failed]');
                                                    else; // console.log('Relationship:\t', '[created]);
                                                    done();
                                                });
                                            }
                                        } else {
                                            // console.log('Relationship:\t', '[failed]');
                                            done();
                                        }
                                    }
                                });
                            });
                        }
                    }

                    stackNgram.start(() => {
                        stackRel.start(() => {
                            // console.log('>>>>>>>>>> nodeIndex', nodeIndex);

                            let end = new Date().getTime();

                            console.log('===========================');
                            console.log(`== Training time: ${(end - start)/(1000 * 60)} ==`);
                            console.log('===========================');
                            
                            callback(grams);
                        });
                    });
                });
            });
        });
    }

    readPOS(filename, callback) {
        let start = new Date().getTime();

        this.open(() => {
            md5File(filename, (err, sum) => {
                if (err) throw err;

                fs.readFile(filename, 'utf8', text => {
                    text = this.tokenize(text);

                    text = this.tagger.tag(text).map(item => item[1]);

                    if (this.options.debug) console.log('text', text);

                    // Generate the n-grams;
                    let grams = {};
                    let unique = {};
                    let nodeIndex = {};

                    let stackNgram = new pstack({
                        progess: 'Reading the N-grams...',
                        reportInterval: 100,
                        batch: 10
                    });

                    let stackRel = new pstack({
                        progress: 'Mapping...',
                        reportInterval: 100
                    });

                    for (let depth of range(this.options.depth[0], this.options.depth[1] + 1)) {
                        console.log(`Starting Depth ${depth}`);
                        console.log('Generating the POS ngrams');

                        grams[depth] = NGrams.ngrams(text, depth);

                        console.log(`Stringification of ${grams[depth].length} POS ngrams.`);
                        
                        let ngramObj = {};

                        grams[depth].forEach(item => {
                            ngramObj[item.join('|')] = true;
                        });

                        let uniqueNgrams = Object.keys(ngramObj).length;

                        console.log('Graphing');

                        for (let gram of ngramObj) {
                            gram = gram.toLowerCase();

                            stackNgram.add(done => {
                                this.graph.save({gram, depth}, `pos-${this.options.name}`, (err, node) => {
                                    if (err) {
                                        // Read it
                                        this.graph.find({gram, depth}, false, `pos-${this.options.name}`, (err, reponse) => {
                                            if (err) throw err;
                                            if (response && response.length > 0) {
                                                nodeIndex[gram] = response[0].id;
                                                if (this.options.debug) console.log('Node:\t\t', '[found]');
                                            }

                                            done();
                                        });

                                        return false;
                                    } else {
                                        // consoel.log('Node:\t\t', '[created]');
                                        nodeIndex[gram] = node.id;
                                        done();
                                    }
                                });
                            });
                        }

                        // Process the gram graph
                        for (let n in grams[depth]) {
                            if (n === 0) return false;

                            let current = grams[depth][n - 1].join('|').toLowerCase();
                            let next = grams[depth][n].slice(-1).join('').toLowerCase();

                            stackRel.add(done => {
                                if (this.options.debug) console.log(">> ",current,' >>> ',next, ' -> ', nodeIndex[current], ' >>> ', nodeIndex[next]);
                                this.graph.relationships(nodeIndex[current], 'out', 'then', (err, relationships) => {
                                    if (err) {
                                        if (this.options.debug) console.log('Relationship:\t', '[failed]');
                                        return false;
                                    } else {
                                        if (relationships) {
                                            // Look for the relationship
                                            let relationship = relationships.find(rel => rel.start == nodeIndex[current] && rel.end == nodeIndex[next]);

                                            if (relationship) {
                                                // Update the relationship weight
                                                relationship.properties.wieght += 1;
                                                
                                                this.graph.rel.update(relationship, err => {
                                                    if (err); if (this.options.debug) console.log('Relationship:\t', '[failed]');
                                                    else; if (this.options.debug) console.log('Relationship:\t', '[updated]');
                                                    done();
                                                });
                                            } else {
                                                this.graph.relate(nodeIndex[current], 'then', nodeIndex[next], {weight: 1, ngram: next, idx: nodeIndex[next]}, (err) => {
                                                    if (err); if (this.options.debug) console.log('Relationship:\t', '[failed]');
                                                    else; if (this.options.debug) console.log('Relationship:\t', '[updated]');
                                                    done();
                                                });
                                            }
                                        } else {
                                            if (this.options.debug) console.log('Relationship:\t', '[failed]');
                                            done();
                                        }
                                    }
                                });
                            });
                        }
                    }

                    stackNgram.start(() => {
                        stackRel.start(() => {
                            if (this.options.debug) console.log('>>>>>>>>> nodeIndex', nodeIndex);

                            let end = new Date().getTime();
                            
                            console.log('===========================');
                            console.log(`== POS Training time: ${(end - start)/(1000*60)} ==`);
                            console.log('===========================');
                        });
                    });
                });
            });
        });
    }

    getNext(chain, callback) {
        let ngrams = {};
        let nodes = {};
        let posngrams = {};
        let posnodes = {};

        if (this.options.debug) console.log('chain', chain);

        this.open(() => {
            let stack = new pstack();
            let buffer = false;

            // Generate the option list, with weights
            for (let depth of range(this.options.depth[1], this.options.depth[0]-1, -1)) {
                stack.add(done => {
                    if (buffer && depth <= this.options.lowpri) {
                        if (this.options.debug) console.log('Skipped.');
                        done();
                        return false;
                    }

                    // Generate the ngram to lookup (last N words in the chain)
                    ngrams[depth] = chain.slice(-depth).join('|').toLowerCase();

                    // Get the nodes
                    // let localNodes = this.getNodes(ngrams[depth]);
                    this.graph.find({gram: ngrams[depth]}, false, `ngram-${this.options.name}`, (err, response) => {
                        if (this.options.debug) console.log('response', ngrams[depth], response);
                        if (err) throw err;
                        if (response && response.length > 0) {
                            this.graph.relationships(response[0].id, 'out', 'then', (err, relationships) => {
                                if (err) throw err;
                                if (relationships.length > 0) {
                                    buffer = true;
                                    if (this.options.debug) console.log('>>>> Depth: ', depth, relationships.length);
                                }

                                // buffer[depth] = relationships;
                                if (false && depth >= 3 && relationships.length === 1) {
                                    // Only one edge. We should go with it, to keep the structure of i'm, it's, they're...
                                    if (this.options.debug) console.log('Going with ', relationships[0].properties.ngram);
                                    nodes = {};
                                    nodes[relationships[0].properties.ngram] = 1;
                                    done();
                                } else {
                                    if (this.options.debug) console.log('relationships', ngrams[depth], relationships);
                                    relationships.forEach(relationship => {
                                        if (nodes[relationship.properties.ngram]) {
                                            // No cumulation!
                                            // nodes[gramId] += count; //*depth*this.options.depthWeight;
                                        } else {
                                            if (this.options.depthWeight) {
                                                nodes[relationship.properties.name] = relationship.properties.weight * Math.pow(depth, this.options.depthweight);
                                            } else {
                                                nodes[relationship.properties.ngram] = relationship.properties.weight;
                                            }
                                        }
                                    });
                                    if (Object.keys(nodes).lenth > 0) buffer = true;
                                    done();
                                }
                            });
                        } else {
                            if (this.options.debug) console.log('ngram not found: ', ngrams[depth]);
                            done();
                        }
                    });
                });
            }

            if (this.options.pos) {
                // For each node option, build the POS
                stack.add(done => {
                    let substack = new pstack();

                    // Check the POs for the current chain
                    if (this.options.debug) console.log('>>', chain);
                    let tags = this.tagger.tag(chain.slice(-20)).map(item => item[1]);

                    for (let depth of range(this.options.depth[1], this.options.depth[0] - 1, -1)) {
                        substack.add(subdone => {
                            // Generate the ngram to lookup (last N words in the chain)
                            posngrams[depth] = tags.slice(-depth).join('|').toLowerCase();
                            if (this.options.debug) console.log('>>>> Depth: ', depth);

                            // Get the nodes
                            // let localeNodes = this.getNodes(ngrams[depth]);
                            this.graph.find({gram: posngrams[depth]}, false, `pos-${this.options.name}`, (err, response) => {
                                if (this.options.debug) console.log('response', posngrams[depth], response);
                                if (err) throw err;
                                if (response && response.length > 0) {
                                    this.graph.relationships(response[0].id, 'out', 'then', (err, relationships) => {
                                        if (depth >= 3 && relationships.length === 1) {
                                            // Only one edge. We should go with it, to keep the structure of i'm, it's, they're...
                                            if (this.options.debug) console.log('Going with ', relationships[0].properties.ngram);

                                            posnodes = {};
                                            posnodes[relationships[0].properties.ngram] = 1;
                                            subdone();
                                        } else {
                                            if (this.options.debug) console.log('relationships', posngrams[depth], relationships);
                                            relationships.forEach(relationship => {
                                                if (posnodes[relationship.properties.ngram]) {
                                                    // No cumulation!
                                                    // nodes[gramId] += count; //*depth*this.options.depthWeight;
                                                } else {
                                                    if (this.options.depthWeight) {
                                                        posnodes[relationship.properties.ngram] = relationship.properties.weight * Math.pow(depth, this.options.depthweight);
                                                    } else {
                                                        posnodes[relationship.properties.ngram] = relationship.properties.weight;
                                                    }
                                                }
                                            });
                                            
                                            subdone();
                                        }
                                    });
                                } else {
                                    if (this.options.debug) console.log('ngram not found: ', ngrams[depth]);
                                    subdone();
                                }
                            });
                        });
                    }

                    // Check the pos structure of each node option

                    for (let k in nodes) {
                        substack.add(subdone => {
                            // Get the POS tag
                            let text = chain.slice(0);
                            text.push(k);
                            if (this.options.debug) console.log('text', text);

                            let tags = this.tagger.tag(text.slice(-10)).map(item => {
                                return item[1];
                            });

                            let tag = tags.slice(-1)[0].toLowerCase(0);
                            if (this.options.debug) console.log(`[${tag}] `, chain.join(' '), '->', k, posnodes[tag]);

                            if (posnodes[tag]) {
                                nodes[k] += posnodes[tag];
                                nodes[k] /= 2;
                            }

                            subdone();
                        });
                    }

                    substack.start(() => {
                        if (this.options.debug) console.log('nodes', nodes);
                        if (this.options.debug) console.log('posnodes', posnodes);
                        if (this.options.debug) console.log('-------------------------');
                        done();
                    });
                });
            }

            stack.start(() => {
                if (this.options.debug) {
                    this.printEdges(nodes, 'Count');
                    console.log(chain.join('|'));
                }

                // Calculate the total
                let total = 0;
                for (let count of nodes) total += count;

                let minP = 1;

                // Calculate the probabilities

                for (let gramId in nodes) {
                    nodes[gramId] = count/total;
                    if (nodes[gramId] < minP) minP = nodes[gramId];
                }

                if (this.options.certainty) {
                    if (minP < this.options.certainty) {
                        // The probabilities are way too low to filter. We need to remove the least probable options
                        let nodeArray = [];
                        for (let id in nodes) nodeArray.push({id, p: nodes[id]});

                        // Sort and slice
                        nodeArray.sort((a, b) => b.p - a.p);
                        nodeArray = nodeArray.slice(0, 100/(this.options.certainty*100));

                        // Convert back to an object
                        nodes = {};
                        nodeArray.forEach(item => nodes[item.id] = item.p);
                        if (this.options.debug) console.log('nodes', nodes);
                    } else {
                        // Remove the lowest probabilities
                        for (let gramId in nodes) {
                            if (nodes[gramId] < this.options.certainty) delete nodes[gramId];
                        }
                    }
                }

                // Recalculate the total
                total = 0;
                for (let p of nodes) {
                    total += p;
                }

                // Recalculate the probabilities
                for (let gramId in nodes) {
                    nodes[gramId] = nodes[gramId]/total;
                }

                let rn = Math.random();

                let _nodes = [];
                for (let k in nodes) _nodes.push([k, nodes[k]]);
                _nodes.sort((a, b) => a[1] - b[1]);

                let wl = new wlist(_nodes);

                let sample = wl.peek()[0];

                // if (sample === '.') this.printEdges(nodes, 'Count');
                /*
                let choices = [];
                for (let gramId in nodes) {
                    let p = nodes[gramId];
                    let count = p*100;
                    count = Math.ceil(Math.pow(count, this.options.weight));
                    for (let n of range(0, count)) choices.push(gramId);
                }

                if (this.options.debug) console.log('choices', choices);
                let sample = choices[Math.floor(Math.random() * choices.length)];
                
                if (chain[chain.length - 1] === "'") {
                    // this.printEdges(nodes, 'Count');
                    // this.printEdges(nodes, `Probabilities: \033[37m\033[44m${chain.slice(-3).join(' ')} ______`);
                    if (this.options.debug) console.log('sample: ', sample);
                    if (this.options.debug) console.log('buffer: ', JSON.stringify(buffer, null, 4));
                }

                if (!sample) console.log('!!!!!!!', choices);
                */

                callback(sample);
            });
        });

        // return this.data.grams[choices[Math.floor(Math.random() * choices.length)]];
    }

    generate(start, count, callback) {
        //let chain	= new pos.Lexer().lex(start);
        /*let tokenizer	= new natural.RegexpTokenizer({pattern: / /});
        let chain = tokenizer.tokenize(start.toLowerCase());*/
        let chain = this.tokenize(start.toLowerCase());

        this.addToChain(chain, callback, count);

        /*
        this.getNext(chain);
        for (let n of range(0, count)) chain.push(this.getNext(chain));
        return this.beautify(chain.join(' ));*/
    }

    addToChain(chain, callback, limit) {
        if (this.options.debug) console.log('>', chain.length, limit);

        if (chain.length === limit) {
            callback(this.beautify(chain.join(' ')));
        } else {
            this.getNext(chain, ngram => {
                if (!ngram) {
                    callback(scope.beautify(chain.join(' ')));
                    return false;
                }
                chain.push(ngram);
                this.addToChain(chain, callback, limit);
            });
        }
    }

    printEdges(nodes, title) {
        nodes = [];
        for (let id in nodes) _nodes.push({id, p: nodes[id]});

        // Sort and slice
        nodes.sort((a, b) => b.p - a.p);
        console.log(`\n\u{1b}[32m ${title}\u{1b}[37m\u{1b}[40m`);
        this.table(nodes, {
            'Word': 'word',
            'Probability': 'p'
        });
    }

    table(array, cols) {
        let table = new tbl({head: Object.keys(cols)});
        array.forEach(item => {
            let row = [];
            for (let k in cols) _nodes.push(item[cols[k]]);
            table.push(row);
        });
        console.log(table.toString());
    }
}

module.exports = Markov;

/*

MATCH p=(x:`ngrams-trump` {gram:'obama'})-[:then*1..20]->(y:`ngrams-trump` {gram:'world'})
RETURN p


MATCH p=shortestPath((x:`ngrams-trump` {gram:'obama'})-[:then*1..20]->(y:`ngrams-trump` {gram:'clinton'}))
RETURN p

MATCH p=(x:`ngrams-trump` {gram:'obama'})-[:then*1..5]->(y:`ngrams-trump` {gram:'clinton'})
RETURN p LIMIT 50


MATCH (x:`ngrams-trump` {gram:'obama'})-[:then*1..5]->()-[:TO|:CC|:BCC]->(person)
RETURN distinct person

MATCH p=(x:`ngrams-trump` {gram:'obama'})-[:then*1..5]->(y:`ngrams-trump` {gram:'clinton'})
RETURN  p AS shortestPath, reduce(weight=0, r in rels : weight+r.weight) AS totalWeight

*/

Array.prototype.flatten = function() {
    const flat = [];

    this.forEach(item => {
        if (Array.isArray(item)) {
            flat.push([].concat.apply([], item));
        } else {
            flat.push(item);
        }
    });

    return [].concat.apply([], flat);
}

function readFile(filename) {
    return new Promise((resolve, reject) => {
        fs.readFile(filename, 'utf8', (err, text) => {
            if (err) {
                reject(err);
            } else {
                resolve(text);
            }
        });
    });
}