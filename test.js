var cmarkov	= require('./cmarkov');

var bot = new cmarkov({
	name:			'trump',
	depth:			[1,5],
	lowpri:			3,
	weight:			1,
	depthWeight:	1,
	certainty:		0.1,
	pos:			true,
	debug:			false
});

//bot.test();

/*
bot.read("training-data/trump.txt", function() {
	bot.readPOS("training-data/trump.txt", function() {
		bot.generate("i", 200, function(str) {
			console.log(str);
		});
	});
});
*/

var start = new Date().getTime();
bot.generate("I would like to talk today",50000, function(str) {
	//console.trace();
	console.log(str);
	
	var end = new Date().getTime();
	var total =	 (end-start)/(1000*60);
	console.log("Time: ",total);
});
