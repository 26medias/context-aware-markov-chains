var _			= require('underscore');
var fstool		= require('fs-tool');
var natural		= require('natural');
var pstack		= require('pstack');
var md5File		= require('md5-file');
var progressbar = require('progress');
var NGrams		= natural.NGrams;
var pos			= require('pos');

var markov = function(options) {
	this.options	= _.extend({
		name:			'dev',
		depth:			[1,3],
		weight:			1.2,
		depthWeight:	2
	}, options);
}

markov.prototype.open	= function(callback) {
	var scope = this;
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
markov.prototype.getNext	= function(chain) {
	var scope	= this;
	var ngrams	= {};
	var nodes	= {};
	// For each ngram depth
	_.each(_.range(scope.options.depth[0], scope.options.depth[1]+1), function(depth) {
		// Generate the ngram
		ngrams[depth]	= chain.slice(-depth);
		ngrams[depth]	= ngrams[depth].join('|').toLowerCase();
		
		// Get the nodes
		var localNodes	= scope.getNodes(ngrams[depth]);
		
		_.each(localNodes, function(count, gramId) {
			if (nodes[gramId]) {
				nodes[gramId]	+= count*depth*scope.options.depthWeight;
			} else {
				nodes[gramId]	= count*depth*scope.options.depthWeight;
			}
		});
	});
	
	//console.log("nodes",nodes);
	
	var choices	= [];
	_.each(nodes, function(count, gramId) {
		count	= Math.pow(count, scope.options.weight);
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
					
					grams[depth]	= NGrams.ngrams(text, depth);
					
					unique[depth]	= _.uniq(_.map(grams[depth], function(item) {
						return item.join('|');
					}));
					
					var bar = new progressbar('Depth '+depth+' [:bar] :percent :etas', {
						complete: 	'=',
						incomplete:	' ',
						clear:		true,
						width: 		20,
						total: 		Math.floor((unique[depth].length+grams[depth].length)/50)
					});
					
					var c	= 0;
					
					// Save the gram
					_.each(unique[depth], function(gram) {
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
				
				scope.close();
				callback(grams);
			});
		});
	});
}

markov.prototype.generate	= function(start, count) {
	var scope	= this;
	var chain	= [start];
	_.each(_.range(0,count), function(n) {
		chain.push(scope.getNext(chain));
	});
	return chain.join(' ');;
}

module.exports = markov;
