var _			= require('underscore');
var fstool		= require('fs-tool');
var natural		= require('natural');
var pstack		= require('pstack');
var md5File		= require('md5-file');
var progressbar = require('progress');
var NGrams		= natural.NGrams;
var pos			= require('pos');
var tbl			= require('cli-table');
var neo4j		= require('neo4j-js');

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

markov.prototype.open	= function(callback) {
	var scope = this;
	neo4j.connect(this.options.db, function (err, graph) {
		scope.graph	= graph;
	});
	
	if (this.data) {
		callback(this.data);
		return true;
	}
	fstool.file.readJson(scope.options.name+'.db', function(data) {
		if (!data) {
			data	= {
				depth:	scope.options.depth,
				grams:	[],	// grams in an array. Index is position. Longer to train, faster to graph
				docs:	{},	// md5 of the docs used to train to avoid double training
				graph:	{}	// {gram:{nextGram:count}}
			};
		}
		scope.data	= data;
		callback(scope.data);
		return true;
	});
	return this;
}

markov.prototype.close	= function(callback) {
	var scope = this;
	if (!callback) {
		callback	= function() {};
	}
	if (!this.data) {
		callback(false);
		return false;
	}
	fstool.file.writeJson(scope.options.name+'.db', this.data, function() {
		callback(scope.true);
		return true;
	});
	return this;
}

markov.prototype.getId	= function(gram) {
	var index = _.indexOf(this.data.grams, gram.toLowerCase());
	return index==-1?false:index;
}
markov.prototype.addGram	= function(gram) {
	var index = _.indexOf(this.data.grams, gram.toLowerCase());
	if (index==-1) {
		this.data.grams.push(gram.toLowerCase());
		return true;
	}
	return false;
}
markov.prototype.getNodes	= function(gram) {
	if (this.data.graph[gram]) {
		return this.data.graph[gram];
	}
	return {};
}
markov.prototype.addNode	= function(g1, g2) {
	var ig2	= this.getId(g2);
	
	if (!this.data.graph[g1.toLowerCase()]) {
		this.data.graph[g1.toLowerCase()]	= {};
	}
	if (!this.data.graph[g1.toLowerCase()][ig2]) {
		this.data.graph[g1.toLowerCase()][ig2]	= 0;
	}
	this.data.graph[g1.toLowerCase()][ig2]++;
	return true;
}
markov.prototype.edges	= function(nodes, title) {
	var scope	= this;
	nodes	= _.map(nodes, function(p, gramId) {
		return {
			id:		gramId,
			word:	scope.data.grams[gramId],
			p:		p
		};
	});
	// Sort and slice
	nodes.sort(function(a, b) {
		return b.p-a.p;
	});
	console.log("\n\033[32m "+title+"\033[37m\033[40m");
	scope.table(nodes,  {
		'Id':			'id',
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
markov.prototype.getNext	= function(chain) {
	var scope	= this;
	var ngrams	= {};
	var nodes	= {};
	// For each ngram depth
	_.each(_.range(scope.options.depth[1], scope.options.depth[0]-1, -1), function(depth) {
		// Generate the ngram to lookup (last N words in the chain)
		ngrams[depth]	= chain.slice(-depth).join('|').toLowerCase();
		
		// Get the nodes
		var localNodes	= scope.getNodes(ngrams[depth]);
		
		//scope.edges(localNodes, "Depth "+depth);
		
		_.each(localNodes, function(count, gramId) {
			
			//console.log(">> ",scope.data.grams[gramId], count, depth, scope.options.depthWeight);
			
			if (nodes[gramId]) {
				// No cumulation!
				//nodes[gramId]	+= count;//*depth*scope.options.depthWeight;
			} else {
				if (scope.options.depthWeight) {
					nodes[gramId]	= count*Math.pow(depth, scope.options.depthWeight);
				} else {
					nodes[gramId]	= count;
				}
			}
		});
	});
	
	//scope.edges(nodes, 'Counts');
	
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
	
	// Recalculate the total
	var total	= 0;
	_.each(nodes, function(p, gramId) {
		total	+= p;
	});
	
	// Recalculate the probabilities
	_.each(nodes, function(p, gramId) {
		nodes[gramId]	= p/total;
	});
	
	if (scope.options.debug) {
		scope.edges(nodes, 'Probabilities: \033[37m\033[44m'+chain.slice(-3).join(' ')+' ______');
	}
	
	//console.log("> ", chain.slice(-5), " -> ", nodes);
	
	var choices	= [];
	_.each(nodes, function(p, gramId) {
		var count	= p*100;
		count		= Math.ceil(Math.pow(count, scope.options.weight));
		_.each(_.range(0,count), function(n) {
			choices.push(gramId);
		});
	});
	
	return this.data.grams[_.sample(choices)];
}

markov.prototype.read	= function(filename, callback) {
	var scope = this;
	
	this.open(function() {
		
		md5File(filename, function (error, sum) {
			if (scope.data.docs[sum]) {
				console.log("Training already done on that document, on "+scope.data.docs[sum]);
				callback(scope.data.grams);
				return false;
			}
			
			scope.data.docs[sum]	= new Date();
			
			fstool.file.read(filename, function(text) {
				
				text	= new pos.Lexer().lex(text);
				
				//console.log("text", text);
				
				// Generate the n-grams
				var grams	= {};
				var unique	= {};
				
				_.each(_.range(scope.options.depth[0], scope.options.depth[1]+1), function(depth) {
					
					console.log("Starting Depth "+depth);
					
					console.log("Generating the ngrams");
					
					grams[depth]	= NGrams.ngrams(text, depth);
					
					console.log("Stringification of "+grams[depth].length+" ngrams");
					var ngramsArray	= _.map(grams[depth], function(item) {
						return item.join('|');
					})
					//console.log("Filtering the duplicates");
					//unique[depth]	= _.uniq(ngramsArray);
					
					var bar = new progressbar('Depth '+depth+' [:bar] :percent :etas', {
						complete: 	'=',
						incomplete:	' ',
						clear:		true,
						width: 		20,
						total: 		Math.floor((ngramsArray.length+grams[depth].length)/50)
					});
					
					var c	= 0;
					
					console.log("Graphing");
					// Save the gram
					//_.each(unique[depth], function(gram) {
					_.each(ngramsArray, function(gram) {
						scope.addGram(gram);
						if (c%50==0) {
							bar.tick();
						}
						c++;
					});
					
					// Process the gram graph
					_.each(grams[depth], function(str, n) {
						if (n==0) {
							return false;
						}
						var current		= grams[depth][n-1].join('|');
						var next		= grams[depth][n].slice(-1).join('');
						
						//console.log("> ", current, next);
						
						scope.addNode(current, next);
						if (c%50==0) {
							bar.tick();
						}
						c++;
					});
				});
				
				// Save the training so far
				console.log("Saving");
				scope.close();
				
				callback(grams);
			});
		});
	});
}

markov.prototype.generate	= function(start, count) {
	var scope	= this;
	var chain	= new pos.Lexer().lex(start);
	_.each(_.range(0,count), function(n) {
		chain.push(scope.getNext(chain));
	});
	return scope.cleanup(chain.join(' '));
}
markov.prototype.cleanup	= function(text) {
	var scope	= this;
	text	= text.replace(new RegExp(' \. ','gmi'), '. ');
	text	= text.replace(new RegExp(' \' ','gmi'), '\'');
	text	= text.replace(new RegExp(' ! ','gmi'), '!');
	text	= text.replace(new RegExp(' , ','gmi'), ', ');
	text	= text.replace(new RegExp(' : ','gmi'), ': ');
	text	= text.replace(new RegExp(' ; ','gmi'), '; ');
	return text;
}

module.exports = markov;
