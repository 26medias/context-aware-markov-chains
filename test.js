const Markov = new(require('./Markov'));

const readMe = './training-data/bible.txt';
const bot = new Markov({
    name: 'bible',
    depth: [1, 5],
    lowpri: 3,
    weight: 1,
    depthWeight: 1,
    certainty: 0.1,
    pos: true,
    debug: true
});

bot.read(readMe, () => {
    console.log('read file');
    bot.readPOS(readMe, () => {
        console.log('read pos');
        bot.generate('god', 200, console.log);
    });
});