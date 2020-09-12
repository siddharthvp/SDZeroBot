const {bot, fs, log} = require('./botbase');

fs.writeFileSync('speed-data', '', console.log);

let timers = new Array(10);
let nextTimer = 0;

let stream = new bot.stream('recentchange', {
	since: new bot.date().subtract(1, 'day')
});

stream.onopen = function() {
	log(`[S] stream opened`);
	for (let i = 0; i < 10; i++) {
		timers[i] = console.time(String(i));
	}
	setTimeout(function() {
		setInterval(function() {
			fs.stat('speed-data', function(err, stats) {
				const megabits = stats.size * 8 / 1000 / 1000;
				console.log(`${megabits} Mb in:`)
				console.timeEnd(String(nextTimer));
				if (nextTimer++ === 10) {
					process.exit();
				}
			});
		}, 1000);
	}, 1000);
}

stream.onmessage = function(ev) {
	fs.appendFile('speed-data', ev.data, function() {});
}