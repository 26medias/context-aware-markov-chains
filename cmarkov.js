var _			= require('underscore');
var fstool		= require('fs-tool');
var natural		= require('natural');
var pstack		= require('pstack');
var md5File		= require('md5-file');
var progressbar = require('progress');
var NGrams		= natural.NGrams;
var pos			= require('pos');
var tbl			= require('cli-table');
var seraph		= require("seraph");
// var Tagger		= require("natural").BrillPOSTagger;
var Tagger      = require("brill-pos-tagger");
var tokenizer	= require("node-tokenizer");
var wlist		= require("./js-weighted-list");

var markov = function(options) {
	this.options	= _.extend({
		db:				'http://localhost:7474',
		name:			'dev',
		depth:			[1,3],
		weight:			1.2,
		depthWeight:	2,
		certainty:		1
	}, options);
}

markov.prototype.tokenize	= function(text) {
	
	var cues	= ["?","!",".",",",":",";","\t","\n","\r"];
	//var cues	= [":"];
	var tokens	= text.split(' ');
	
	//console.log("tokens",tokens);
	
	_.each(cues, function(cue) {
		tokens	= _.map(tokens, function(token) {
			var parts	= token.split(cue);
			var l = parts.length;
			if (l==0) {
				return token;
			}
			var buffer	= [];
			_.each(parts, function(part, n) {
				buffer.push(part);
				if (n<l-1) {
					buffer.push(cue);
				}
			});
			return buffer;
		});
		tokens	= _.flatten(tokens);
		tokens	= _.filter(tokens, function(item) {
			return item	!= '';
		});
		//console.log("tokens",tokens);
	});
	
	return tokens;
}

markov.prototype.test	= function() {
	var scope = this;
	
	var text	= 'I would like to talk today about: how to develop a new foreign policy direction for our country? one that replaces! randomness with purpose, ideology with strategy, and chaos with peace.\n\nIt is time to shake the rust off of America�s foreign policy. It\'s time to invite new voices and new visions into the fold.';
	
	var text2	= 'i started � i did it , i was, oh, that first couple of weeks with illegal immigration and mexico and all of this stuff , right ? and all of a sudden , people are coming over , and i say the wall and now they�re starting to look elsewhere for help . i started � i did it , i was , oh , that first couple of weeks with illegal immigration';
	
	console.log(this.beautify(text2));
}

markov.prototype.beautify	= function(text) {
	// Punctuation
	var text	= text.replace(new RegExp('\\s(\\.|,|:|;|!|\\?)\\s','gmi'), function(match, punct) {
		return punct+' ';
	});
	// Capitalize
	var text	= text.replace(new RegExp('(\\.|!|\\?|\\n)(\\s)([a-z])','gmi'), function(match, punct, space, letter) {
		return punct+space+letter.toUpperCase();
	});
	text	= text.substr(0,1).toUpperCase()+text.substr(1);
	return text;
}

markov.prototype.test2	= function(callback) {
	var scope = this;
	this.open(function() {
		scope.graph.query("MATCH p=(x:`ngrams-trump` {gram:{x}})-[:then*1..50]->(y:`ngrams-trump` {gram:{y}}) RETURN p LIMIT 50", {x: 'world', y:'trump'}, function(err, result) {
			if (result) {
				_.each(result, function(item) {
					var nodes	= _.map(item.nodes, function(node) {
						return node.split('/').pop();
					});
					
					var stack	= new pstack();
					var grams	= [];
					
					_.each(nodes, function(node) {
						stack.add(function(done) {
							scope.graph.read(node, function(err, node) {
								if (node) {
									grams.push(node.gram);
								}
								done();
							});
						});
					});
					
					stack.start(function() {
						console.log("----------------------\n",grams.join(' '));
					});
					
					
					//console.log("nodes",nodes);
				});
			}
			//console.log("result",result);
		});
	});
	
	
	return this;
}

markov.prototype.open	= function(callback) {
	var scope = this;
	scope.graph	= seraph({
		server:	"http://localhost:7474",
		user:	"neo4j",
		pass:	"pwd"
	});
	scope.graph.constraints.uniqueness.createIfNone('ngrams-'+scope.options.name, 'gram', function(err, constraint) {
		scope.graph.constraints.uniqueness.createIfNone('pos-'+scope.options.name, 'gram', function(err, constraint) {
			var base_folder = "./node_modules/natural/lib/natural/brill_pos_tagger/data/English";
			var rules_file = base_folder + "/tr_from_posjs.txt";
			var lexicon_file = base_folder + "/lexicon_from_posjs.json";
			var default_category = 'N';
			
			var tagger;
			tagger = new Tagger(lexicon_file, rules_file, default_category, function(error) {
				if (error) {
					console.log(error);
				} else {
					scope.tagger	= tagger;
					callback();
				}
			});
			
		});
	});
	
	return this;
}

markov.prototype.read	= function(filename, callback) {
	var scope = this;
	
	var start = new Date().getTime();
	
	this.open(function() {
		md5File(filename, function (error, sum) {
			/*if (scope.data.docs[sum]) {
				console.log("Training already done on that document, on "+scope.data.docs[sum]);
				callback(scope.data.grams);
				return false;
			}
			
			scope.data.docs[sum]	= new Date();
			*/
			fstool.file.read(filename, function(text) {
				
				//text	= new pos.Lexer().lex(text);
				/*var tokenizer = new natural.RegexpTokenizer({pattern: / /});
				text	= tokenizer.tokenize(text);*/
				text	= scope.tokenize(text);
				//console.log("text", text);
				
				// Generate the n-grams
				var grams	= {};
				var unique	= {};
				var nodeIndex	= {};
				
				
				var stack_ngram	= new pstack({
					progress:		'Reading the N-grams...',
					reportInterval:	100,
					batch:			10
				});
				
				var stack_rel	= new pstack({
					progress:		'Mapping...',
					reportInterval:	100
				});
				
				_.each(_.range(scope.options.depth[0], scope.options.depth[1]+1), function(depth) {
					
					console.log("Starting Depth "+depth);
					
					console.log("Generating the ngrams");
					
					grams[depth]	= NGrams.ngrams(text, depth);
					
					console.log("Stringification of "+grams[depth].length+" ngrams");
					var ngramObj	= {};
					_.each(grams[depth], function(item) {
						ngramObj[item.join('|')] = true;
					});
					
					var uniqueNgams	= _.size(ngramObj);
					
					console.log("Graphing");
					
					// Save the gram
					_.each(ngramObj, function(v, gram) {
						gram	= gram.toLowerCase();
						stack_ngram.add(function(done) {
							scope.graph.save({
								gram:	gram,
								depth:	depth
							}, 'ngrams-'+scope.options.name, function(err, node) {
								if (err) {
									// Read it
									scope.graph.find({
										gram:	gram,
										depth:	depth
									}, false, 'ngrams-'+scope.options.name, function (err, response) {
										if (response && response.length > 0) {
											nodeIndex[gram]	= response[0].id;
											//console.log("Node:\t\t", "[found]");
										}
										done();
									});
									return false;
								} else {
									//console.log("Node:\t\t", "[created]");
									nodeIndex[gram]	= node.id;
									done();
								}
							});
						});
					});
					
					// Process the gram graph
					_.each(grams[depth], function(str, n) {
						if (n==0) {
							return false;
						}
						var current		= grams[depth][n-1].join('|').toLowerCase();
						var next		= grams[depth][n].slice(-1).join('').toLowerCase();
						
						stack_rel.add(function(done) {
							//console.log(">> ",current,' >>> ',next, ' -> ', nodeIndex[current], ' >>> ', nodeIndex[next]);
							
							scope.graph.relationships(nodeIndex[current], 'out', 'then', function(err, relationships) {
								if (err) {
									//console.log("Relationship:\t", "[failed]");
									return false;
								} else {
									if (relationships) {
										// Look for the relationship
										var relationship	 = _.find(relationships, function(rel) {
											return rel.start == nodeIndex[current] && rel.end == nodeIndex[next];
										});
										
										if (relationship) {
											// Update the relationship weight
											relationship.properties.weight += 1;
											scope.graph.rel.update(relationship, function(err) {
												if (err) {
													//console.log("Relationship:\t", "[failed]");
												}
												//console.log("Relationship:\t", "[updated]");
												done();
											});
										} else {
											scope.graph.relate(nodeIndex[current], 'then', nodeIndex[next], {weight:1, ngram:next, idx:nodeIndex[next]}, function(err, relationship) {
												if (err) {
													//console.log("Relationship:\t", "[failed]");
												} else {
													//console.log("Relationship:\t", "[created]");
												}
												done();
											});
										}
											
									} else {
										//console.log("Relationship:\t", "[failed]");
										done();
									}
								}
							});
							
						});
					});
					
				});
				
				stack_ngram.start(function() {
					stack_rel.start(function() {
						//console.log(">>>>>>>>> nodeIndex",nodeIndex);
						
						var end = new Date().getTime();
						
						
						console.log("===========================");
						console.log("== Training time: ",(end-start)/(1000*60)," ==");
						console.log("===========================");
						
						callback(grams);
					});
				});
			});
		});
	});
}

markov.prototype.readPOS	= function(filename, callback) {
	var scope = this;
	
	var start = new Date().getTime();
	
	this.open(function() {
		md5File(filename, function (error, sum) {
			fstool.file.read(filename, function(text) {
				
				//text	= new pos.Lexer().lex(text);
				/*var tokenizer = new natural.RegexpTokenizer({pattern: / /});
				text	= tokenizer.tokenize(text);*/
				text	= scope.tokenize(text);
				
				text = _.map(scope.tagger.tag(text), function(item) {
					return item[1];
				});
				
				//console.log("text", text);
				
				// Generate the n-grams
				var grams	= {};
				var unique	= {};
				var nodeIndex	= {};
				
				
				var stack_ngram	= new pstack({
					progress:		'Reading the N-grams...',
					reportInterval:	100,
					batch:			10
				});
				
				var stack_rel	= new pstack({
					progress:		'Mapping...',
					reportInterval:	100
				});
				
				
				_.each(_.range(scope.options.depth[0], scope.options.depth[1]+1), function(depth) {
					
					console.log("Starting Depth "+depth);
					
					console.log("Generating the POS ngrams");
					
					grams[depth]	= NGrams.ngrams(text, depth);
					
					console.log("Stringification of "+grams[depth].length+" POS ngrams");
					var ngramObj	= {};
					_.each(grams[depth], function(item) {
						ngramObj[item.join('|')] = true;
					});
					
					var uniqueNgams	= _.size(ngramObj);
					
					console.log("Graphing");
					
					// Save the gram
					_.each(ngramObj, function(v, gram) {
						gram	= gram.toLowerCase();
						stack_ngram.add(function(done) {
							scope.graph.save({
								gram:	gram,
								depth:	depth
							}, 'pos-'+scope.options.name, function(err, node) {
								if (err) {
									// Read it
									scope.graph.find({
										gram:	gram,
										depth:	depth
									}, false, 'pos-'+scope.options.name, function (err, response) {
										if (response && response.length > 0) {
											nodeIndex[gram]	= response[0].id;
											//console.log("Node:\t\t", "[found]");
										}
										done();
									});
									return false;
								} else {
									//console.log("Node:\t\t", "[created]");
									nodeIndex[gram]	= node.id;
									done();
								}
							});
						});
					});
					
					// Process the gram graph
					_.each(grams[depth], function(str, n) {
						if (n==0) {
							return false;
						}
						var current		= grams[depth][n-1].join('|').toLowerCase();
						var next		= grams[depth][n].slice(-1).join('').toLowerCase();
						
						stack_rel.add(function(done) {
							//console.log(">> ",current,' >>> ',next, ' -> ', nodeIndex[current], ' >>> ', nodeIndex[next]);
							
							scope.graph.relationships(nodeIndex[current], 'out', 'then', function(err, relationships) {
								if (err) {
									//console.log("Relationship:\t", "[failed]");
									return false;
								} else {
									if (relationships) {
										// Look for the relationship
										var relationship	 = _.find(relationships, function(rel) {
											return rel.start == nodeIndex[current] && rel.end == nodeIndex[next];
										});
										
										if (relationship) {
											// Update the relationship weight
											relationship.properties.weight += 1;
											scope.graph.rel.update(relationship, function(err) {
												if (err) {
													//console.log("Relationship:\t", "[failed]");
												}
												//console.log("Relationship:\t", "[updated]");
												done();
											});
										} else {
											scope.graph.relate(nodeIndex[current], 'then', nodeIndex[next], {weight:1, ngram:next, idx:nodeIndex[next]}, function(err, relationship) {
												if (err) {
													//console.log("Relationship:\t", "[failed]");
												} else {
													//console.log("Relationship:\t", "[created]");
												}
												done();
											});
										}
											
									} else {
										//console.log("Relationship:\t", "[failed]");
										done();
									}
								}
							});
							
						});
					});
				});
				
				stack_ngram.start(function() {
					stack_rel.start(function() {
						//console.log(">>>>>>>>> nodeIndex",nodeIndex);
						
						var end = new Date().getTime();
						
						
						console.log("===========================");
						console.log("== POS Training time: ",(end-start)/(1000*60)," ==");
						console.log("===========================");
						
						callback(grams);
					});
				});
				
			});
		});
	});
}



markov.prototype.getNext	= function(chain, callback) {
	var scope		= this;
	var ngrams		= {};
	var nodes		= {};
	var posngrams	= {};
	var posnodes	= {};
	
	//console.log("chain",chain);
	
	this.open(function() {
		
		var stack	= new pstack();
		var buffer	= false;
		
		
		// Generate the option list, with weights
		_.each(_.range(scope.options.depth[1], scope.options.depth[0]-1, -1), function(depth) {
			stack.add(function(done) {
				if (buffer && depth <= scope.options.lowpri) {
					//console.log("skiped.");
					done();
					return false;
				}
				
				
				// Generate the ngram to lookup (last N words in the chain)
				ngrams[depth]	= chain.slice(-depth).join('|').toLowerCase();
				
				// Get the nodes
				//var localNodes	= scope.getNodes(ngrams[depth]);
				scope.graph.find({
					gram:	ngrams[depth]
				}, false, 'ngrams-'+scope.options.name, function (err, response) {
					//console.log("response",ngrams[depth], response);
					if (response && response.length>0) {
						scope.graph.relationships(response[0].id, 'out', 'then', function(err, relationships) {
							
							if (relationships.length==0) {
								
							} else {
								buffer	= true;
								//console.log(">>>> Depth: ", depth, relationships.length);
							}
							
							//buffer[depth]	= relationships;
							if (false && depth>=3 && relationships.length==1) {
								// Only one edge. We should go with it, to keep the structure of i'm, it's, they're...
								//console.log("Going with ",relationships[0].properties.ngram);
								nodes	= {};
								nodes[relationships[0].properties.ngram]	= 1;
								done();
							} else {
								//console.log("relationships",ngrams[depth], relationships);
								_.each(relationships, function(relationship) {
									
									if (nodes[relationship.properties.ngram]) {
										// No cumulation!
										//nodes[gramId]	+= count;//*depth*scope.options.depthWeight;
									} else {
										if (scope.options.depthWeight) {
											nodes[relationship.properties.ngram]	= relationship.properties.weight*Math.pow(depth, scope.options.depthWeight);
										} else {
											nodes[relationship.properties.ngram]	= relationship.properties.weight;
										}
									}
								});
								if (_.size(nodes)>0) {
									buffer	= true;
								}
								done();
							}
							
							
						});
					} else {
						//console.log("ngram not found: ", ngrams[depth]);
						done();
					}
					
				});
			});
		});
		
		if (scope.options.pos) {
			// For each node option, build the POS
			stack.add(function(done) {
				
				var substack	= new pstack();
				
				// Check the POS for the current chain
				//console.log(">>",chain);
				var tags	= _.map(scope.tagger.tag(chain.slice(-20)), function(item) {
					return item[1];
				});
				
				
				// Generate the option list, with weights
				_.each(_.range(scope.options.depth[1], scope.options.depth[0]-1, -1), function(depth) {
					substack.add(function(subdone) {
						// Generate the ngram to lookup (last N words in the chain)
						posngrams[depth]	= tags.slice(-depth).join('|').toLowerCase();
						//console.log(">>>> Depth: ",depth);
						// Get the nodes
						//var localNodes	= scope.getNodes(ngrams[depth]);
						scope.graph.find({
							gram:	posngrams[depth]
						}, false, 'pos-'+scope.options.name, function (err, response) {
							//console.log("response",posngrams[depth], response);
							if (response && response.length>0) {
								scope.graph.relationships(response[0].id, 'out', 'then', function(err, relationships) {
									
									
									if (depth>=3 && relationships.length==1) {
										// Only one edge. We should go with it, to keep the structure of i'm, it's, they're...
										//console.log("Going with ",relationships[0].properties.ngram);
										posnodes	= {};
										posnodes[relationships[0].properties.ngram]	= 1;
										subdone();
									} else {
										//console.log("relationships",posngrams[depth], relationships);
										_.each(relationships, function(relationship) {
											
											if (posnodes[relationship.properties.ngram]) {
												// No cumulation!
												//nodes[gramId]	+= count;//*depth*scope.options.depthWeight;
											} else {
												if (scope.options.depthWeight) {
													posnodes[relationship.properties.ngram]	= relationship.properties.weight*Math.pow(depth, scope.options.depthWeight);
												} else {
													posnodes[relationship.properties.ngram]	= relationship.properties.weight;
												}
											}
										});
										subdone();
									}
								});
							} else {
								//console.log("ngram not found: ", ngrams[depth]);
								subdone();
							}
							
						});
					});
				});
				
				// Check the pos structure of each node option
				_.each(nodes, function(w,k) {
					substack.add(function(subdone) {
						// Get the POS tag
						var text	= chain.slice(0);
						text.push(k);
						//console.log("text",text);
						var tags	= _.map(scope.tagger.tag(text.slice(-10)), function(item) {
							return item[1];
						});
						
						var tag = tags.slice(-1)[0].toLowerCase();
						
						//console.log("["+tag+"] ",chain.join(' '),'->',k, posnodes[tag]);
						if (posnodes[tag]) {
							nodes[k]	+= posnodes[tag];
							nodes[k]	/= 2;
						}
						subdone();
					});
				});
				
				
				
				substack.start(function() {
					//console.log("nodes",nodes);
					//console.log("posnodes",posnodes);
					//console.log("-------------------------");
					done();
				});
				
			});
		}
		
		
		stack.start(function() {
			
			
			if (scope.options.debug) {
				scope.print_edges(nodes, 'Count');
				console.log(chain.join('|'));
			}
			
			// Calculate the total
			var total	= 0;
			_.each(nodes, function(count, gramId) {
				total	+= count;
			});
			
			var minP = 1;
			
			// Calculate the probabilities
			_.each(nodes, function(count, gramId) {
				nodes[gramId]	= count/total;
				if (nodes[gramId] < minP) {
					minP	= nodes[gramId];
				}
			});
			
			if (scope.options.certainty) {
				if (minP < scope.options.certainty) {
					// The probabilities are way too low to filter. We need to remove the least probable options
					var nodeArray	= _.map(nodes, function(p, gramId) {
						return {
							id:	gramId,
							p:	p
						};
					});
					// Sort and slice
					nodeArray.sort(function(a, b) {
						return b.p-a.p;
					});
					nodeArray	= nodeArray.slice(0, 100/(scope.options.certainty*100));
					
					// Convert back to an object
					nodes	= {};
					_.each(nodeArray, function(item) {
						nodes[item.id]	= item.p;
					});
					//console.log("nodes",nodes);
				} else {
					// Remove the lowest probabilities
					nodes	= _.omit(nodes, function(p, gramId) {
						return p < scope.options.certainty
					});
				}
			}
			
			// Recalculate the total
			var total	= 0;
			_.each(nodes, function(p, gramId) {
				total	+= p;
			});
			
			// Recalculate the probabilities
			_.each(nodes, function(p, gramId) {
				nodes[gramId]	= p/total;
			});
			
			
			var rn	= Math.random();
			
			var _nodes	= _.map(nodes, function(v,k) {return [k,v]});
			_nodes.sort(function(a,b) {
				return a[1]-b[1];
			});
			
			var wl	= new wlist(_nodes);
			
			
			var sample	= wl.peek()[0];
			/*
			if (sample=='.') {
				scope.print_edges(nodes, 'Count');
			}
			*/
			/*
			var choices	= [];
			_.each(nodes, function(p, gramId) {
				var count	= p*100;
				count		= Math.ceil(Math.pow(count, scope.options.weight));
				_.each(_.range(0,count), function(n) {
					choices.push(gramId);
				});
			});
			
			//console.log("choices",choices);
			var sample	= _.sample(choices);
			if (chain[chain.length-1]=='\'') {
				//scope.print_edges(nodes, 'Count');
				//scope.print_edges(nodes, 'Probabilities: \033[37m\033[44m'+chain.slice(-3).join(' ')+' ______');
				//console.log("sample: ",sample);
				//console.log("buffer:",JSON.stringify(buffer,null,4));
			}
			
			if (!sample) {
				//console.log("!!!!!!!",choices);
			}
			*/
			callback(sample);
		});
		
	});
	
	//return this.data.grams[_.sample(choices)];
}

markov.prototype.generate	= function(start, count, callback) {
	var scope	= this;
	//var chain	= new pos.Lexer().lex(start);
	/*var tokenizer	= new natural.RegexpTokenizer({pattern: / /});
	var chain		= tokenizer.tokenize(start.toLowerCase());*/
	chain	= scope.tokenize(start.toLowerCase());
	
	this.addToChain(chain, callback, count);
	/*
	this.getNext(chain)
	_.each(_.range(0,count), function(n) {
		chain.push(scope.getNext(chain));
	});
	return scope.beautify(chain.join(' '));*/
}
markov.prototype.addToChain	= function(chain, callback, limit) {
	var scope	= this;
	//console.log(">",chain.length,limit);
	if (chain.length==limit) {
		callback(scope.beautify(chain.join(' ')));
	} else {
		this.getNext(chain, function(ngram) {
			if (!ngram) {
				callback(scope.beautify(chain.join(' ')));
				return false;
			}
			chain.push(ngram);
			scope.addToChain(chain, callback, limit);
		});
	}
}

markov.prototype.print_edges	= function(nodes, title) {
	var scope	= this;
	nodes	= _.map(nodes, function(p, gramId) {
		return {
			word:	gramId,
			p:		p
		};
	});
	// Sort and slice
	nodes.sort(function(a, b) {
		return b.p-a.p;
	});
	console.log("\n\033[32m "+title+"\033[37m\033[40m");
	scope.table(nodes,  {
		'Word':			'word',
		'Probability':	'p'
	});
}
markov.prototype.table	= function(array, cols) {
	var scope	= this;
	var table = new tbl({
		head: _.keys(cols)
	});
	_.each(array, function(item) {
		var row = _.map(cols, function(v,k) {
			return item[v];
		});
		table.push(row);
	});
	console.log(table.toString());
}

module.exports = markov;


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
