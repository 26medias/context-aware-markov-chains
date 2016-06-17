var cmarkov	= require('./cmarkov');

var bot = new cmarkov({
	name:			'bible-3-3',
	depth:			[3,3],
	weight:			1,
	depthWeight:	3,
	certainty:		0.3,
	debug:			false
});

bot.read("bible.txt", function(grams) {
	//console.log(grams);
	
	console.log(">> ", bot.generate("In the beginning", 200));
});