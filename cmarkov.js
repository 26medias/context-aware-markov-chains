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

markov.prototype.test	= function(callback) {
	var scope = this;
	
	var tokenizer	= new natural.RegexpTokenizer({pattern: / /});
	var chain		= tokenizer.tokenize("Thank you so much.  That's so nice.  Isn't he a great guy.  He doesn't get a fair press; he doesn't get it.  It's just not fair.  And I have to tell you I'm here, and very strongly here, because I have great respect for Steve King and have great respect likewise for Citizens United, David and everybody, and tremendous resect for the Tea Party.  Also, also the people of Iowa.  They have something in common.  Hard-working people.  They want to work, they want to make the country great.  I love the people of Iowa.  So that's the way it is.  Very simple. \n\nWith that said, our country is really headed in the wrong direction with a president who is doing an absolutely terrible job.  The world is collapsing around us, and many of the problems we've caused.  Our president is either grossly incompetent, a word that more and more people are using, and I think I was the first to use it, or he has a completely different agenda than you want to know about, which could be possible.  In any event, Washington is broken, and our country is in serious trouble and total disarray.  Very simple.  Politicians are all talk, no action.  They are all talk and no action.  And it's constant; it never ends. ");
	console.log("chain",chain);
	return this;
}

markov.prototype.open	= function(callback) {
	var scope = this;
	scope.graph	= seraph({
		server:	"http://localhost:7474",
		user:	"neo4j",
		pass:	"pwd"
	});
	scope.graph.constraints.uniqueness.createIfNone('ngrams-'+this.options.name, 'gram', function(err, constraint) {
		//console.log("constraint: ", constraint); 
		callback();
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
				var tokenizer = new natural.RegexpTokenizer({pattern: / /});
				text	= tokenizer.tokenize(text);
				
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



markov.prototype.getNext	= function(chain, callback) {
	var scope	= this;
	var ngrams	= {};
	var nodes	= {};
	
	//console.log("chain",chain);
	
	this.open(function() {
		
		var stack	= new pstack();
		var buffer	= {};
		
		
		// For each ngram depth
		_.each(_.range(scope.options.depth[1], scope.options.depth[0]-1, -1), function(depth) {
			stack.add(function(done) {
				// Generate the ngram to lookup (last N words in the chain)
				ngrams[depth]	= chain.slice(-depth).join('|').toLowerCase();
				//console.log(">>>> Depth: ",depth);
				// Get the nodes
				//var localNodes	= scope.getNodes(ngrams[depth]);
				scope.graph.find({
					gram:	ngrams[depth]
				}, false, 'ngrams-'+scope.options.name, function (err, response) {
					//console.log("response",ngrams[depth], response);
					if (response && response.length>0) {
						scope.graph.relationships(response[0].id, 'out', 'then', function(err, relationships) {
							
							buffer[depth]	= relationships;
							if (depth<=3 && relationships.length==1) {
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
		
		
		stack.start(function() {
			
			
			if (scope.options.debug) {
				scope.print_edges(nodes, 'Count');
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
			/*
			if (scope.options.debug) {
				scope.print_edges(nodes, 'Probabilities: \033[37m\033[44m'+chain.slice(-3).join(' ')+' ______');
			}
			*/
			//console.log("> ", chain.slice(-5), " -> ", nodes);
			
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
			callback(sample);
		});
		
	});
	
	//return this.data.grams[_.sample(choices)];
}

markov.prototype.generate	= function(start, count, callback) {
	var scope	= this;
	//var chain	= new pos.Lexer().lex(start);
	var tokenizer	= new natural.RegexpTokenizer({pattern: / /});
	var chain		= tokenizer.tokenize(start.toLowerCase());
	
	this.addToChain(chain, callback, count);
	/*
	this.getNext(chain)
	_.each(_.range(0,count), function(n) {
		chain.push(scope.getNext(chain));
	});
	return scope.cleanup(chain.join(' '));*/
}
markov.prototype.addToChain	= function(chain, callback, limit) {
	var scope	= this;
	//console.log(">",chain.length,limit);
	if (chain.length==limit) {
		callback(scope.cleanup(chain.join(' ')));
	} else {
		this.getNext(chain, function(ngram) {
			chain.push(ngram);
			scope.addToChain(chain, callback, limit);
		});
	}
}
markov.prototype.cleanup	= function(text) {
	var scope	= this;
	/*text	= text.replace(new RegExp(' \. ','gmi'), '. ');
	text	= text.replace(new RegExp(' \' ','gmi'), '\'');
	text	= text.replace(new RegExp(' ! ','gmi'), '!');
	text	= text.replace(new RegExp(' , ','gmi'), ', ');
	text	= text.replace(new RegExp(' : ','gmi'), ': ');
	text	= text.replace(new RegExp(' ; ','gmi'), '; ');*/
	return text;
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
