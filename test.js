var cmarkov	= require('./cmarkov');

var bot = new cmarkov({
	name:			'southpark2-1-10',
	depth:			[1,10],
	weight:			1,
	depthWeight:	4
});

bot.read("southpark2.txt", function(grams) {
	//console.log(grams);
	
	console.log(">> ", bot.generate("I", 500));
});