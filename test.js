var cmarkov	= require('./cmarkov');

var bot = new cmarkov({
	name:			'trump',
	depth:			[1,5],
	weight:			2,
	depthWeight:	3,
	certainty:		0.5,
	debug:			false
});

//bot.test();

bot.read("training-data/trump.txt", function(grams) {
	//console.log(grams);
	//console.log(">> ", bot.generate("world", 1));
	bot.generate("I", 500, function(str) {
		console.log(">>>>> ",str);
	})
});
