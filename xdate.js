// Date library, copied off morebits.js (though originally written by me)

/**
 * **************** xdate ****************
 */

/**
 * @constructor
 * Create a date object. MediaWiki timestamp format is also acceptable,
 * in addition to everything that JS Date() accepts.
 */
var xdate = function() {
	var args = Array.prototype.slice.call(arguments);

	if (typeof args[0] === 'string') {
		// Attempt to remove a comma and paren-wrapped timezone, to get MediaWiki timestamps to parse
		// Firefox (at least in 75) seems to be okay with the comma, though
		args[0] = args[0].replace(/(\d\d:\d\d),/, '$1').replace(/\(UTC\)/, 'UTC');
	}
	this._d = new (Function.prototype.bind.apply(Date, [Date].concat(args)));

	// parse MediaWiki format: YYYYMMDDHHmmss (used in afd-sorting)
	if (isNaN(this._d.getTime()) && typeof args[0] === 'string' && /^\d{14}$/.test(args[0])) {
		let match = /(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(args[0]);
		match[2] = parseInt(match[2]) - 1; // fix month
		this._d = new (Function.prototype.bind.apply(Date, [Date].concat(match.slice(1))));
	}

	// Still no?
	if (isNaN(this._d.getTime())) {
		console.warn('Invalid initialisation of xdate object: ', args);
	}
};

xdate.localeData = {
	months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
	monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
	days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
	daysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
	relativeTimes: {
		thisDay: '[Today at] h:mm A',
		prevDay: '[Yesterday at] h:mm A',
		nextDay: '[Tomorrow at] h:mm A',
		thisWeek: 'dddd [at] h:mm A',
		pastWeek: '[Last] dddd [at] h:mm A',
		other: 'YYYY-MM-DD'
	}
};

// Allow native Date.prototype methods to be used on xdate objects
Object.getOwnPropertyNames(Date.prototype).forEach(function(func) {
	xdate.prototype[func] = function() {
		return this._d[func].apply(this._d, Array.prototype.slice.call(arguments));
	};
});

Object.assign(xdate.prototype, {

	isValid: function() {
		return !isNaN(this.getTime());
	},

	/** @param {(Date|xdate)} date */
	isBefore: function(date) {
		return this.getTime() < date.getTime();
	},
	isAfter: function(date) {
		return this.getTime() > date.getTime();
	},

	/** @return {string} */
	getUTCMonthName: function() {
		return xdate.localeData.months[this.getUTCMonth()];
	},
	getUTCMonthNameAbbrev: function() {
		return xdate.localeData.monthsShort[this.getUTCMonth()];
	},
	getMonthName: function() {
		return xdate.localeData.months[this.getMonth()];
	},
	getMonthNameAbbrev: function() {
		return xdate.localeData.monthsShort[this.getMonth()];
	},
	getUTCDayName: function() {
		return xdate.localeData.days[this.getUTCDay()];
	},
	getUTCDayNameAbbrev: function() {
		return xdate.localeData.daysShort[this.getUTCDay()];
	},
	getDayName: function() {
		return xdate.localeData.days[this.getDay()];
	},
	getDayNameAbbrev: function() {
		return xdate.localeData.daysShort[this.getDay()];
	},

	/**
	 * Add a given number of minutes, hours, days, months or years to the date.
	 * This is done in-place. The modified date object is also returned, allowing chaining.
	 * @param {number} number - should be an integer
	 * @param {string} unit
	 * @throws {Error} if invalid or unsupported unit is given
	 * @returns {xdate}
	 */
	add: function(number, unit) {
		// mapping time units with getter/setter function names
		var unitMap = {
			seconds: 'Seconds',
			minutes: 'Minutes',
			hours: 'Hours',
			days: 'Date',
			months: 'Month',
			years: 'FullYear'
		};
		var unitNorm = unitMap[unit] || unitMap[unit + 's']; // so that both singular and  plural forms work
		if (unitNorm) {
			this['set' + unitNorm](this['get' + unitNorm]() + number);
			return this;
		}
		throw new Error('Invalid unit "' + unit + '": Only ' + Object.keys(unitMap).join(', ') + ' are allowed.');
	},

	/**
	 * Subtracts a given number of minutes, hours, days, months or years to the date.
	 * This is done in-place. The modified date object is also returned, allowing chaining.
	 * @param {number} number - should be an integer
	 * @param {string} unit
	 * @throws {Error} if invalid or unsupported unit is given
	 * @returns {xdate}
	 */
	subtract: function(number, unit) {
		return this.add(-number, unit);
	},

	/**
	 * Formats the date into a string per the given format string.
	 * Replacement syntax is a subset of that in moment.js.
	 * **Different from morebits.js version: takes zone=utc by default**
	 * @param {string} formatstr
	 * @param {(string|number)} [zone=utc] - 'system' (for browser-default time zone),
	 * 'utc' (for UTC), or specify a time zone as number of minutes past UTC.
	 * @returns {string}
	 */
	format: function(formatstr, zone) {
		if (!this.isValid()) {
			return ''; // avoid bogus NaNs in output
		}
		var udate = this;
		// create a new date object that will contain the date to display as system time
		if (!zone || zone === 'utc') {
			udate = new xdate(this.getTime()).add(this.getTimezoneOffset(), 'minutes');
		} else if (typeof zone === 'number') {
			// convert to utc, then add the utc offset given
			udate = new xdate(this.getTime()).add(this.getTimezoneOffset() + zone, 'minutes');
		}

		var pad = function(num) {
			return num < 10 ? '0' + num : num;
		};
		var h24 = udate.getHours(), m = udate.getMinutes(), s = udate.getSeconds();
		var D = udate.getDate(), M = udate.getMonth() + 1, Y = udate.getFullYear();
		var h12 = h24 % 12 || 12, amOrPm = h24 >= 12 ? 'PM' : 'AM';
		var replacementMap = {
			'HH': pad(h24), 'H': h24, 'hh': pad(h12), 'h': h12, 'A': amOrPm,
			'mm': pad(m), 'm': m,
			'ss': pad(s), 's': s,
			'dddd': udate.getDayName(), 'ddd': udate.getDayNameAbbrev(), 'd': udate.getDay(),
			'DD': pad(D), 'D': D,
			'MMMM': udate.getMonthName(), 'MMM': udate.getMonthNameAbbrev(), 'MM': pad(M), 'M': M,
			'YYYY': Y, 'YY': pad(Y % 100), 'Y': Y
		};

		var unbinder = new xunbinder(formatstr); // escape stuff between [...]
		unbinder.unbind('\\[', '\\]');
		unbinder.content = unbinder.content.replace(
			/* Regex notes:
			 * d(d{2,3})? matches exactly 1, 3 or 4 occurrences of 'd' ('dd' is treated as a double match of 'd')
			 * Y{1,2}(Y{2})? matches exactly 1, 2 or 4 occurrences of 'Y'
			 */
			/H{1,2}|h{1,2}|m{1,2}|s{1,2}|d(d{2,3})?|D{1,2}|M{1,4}|Y{1,2}(Y{2})?|A/g,
			function(match) {
				return replacementMap[match];
			}
		);
		return unbinder.rebind().replace(/\[(.*?)\]/g, '$1');
	},

	/**
	 * Gives a readable relative time string such as "Yesterday at 6:43 PM" or "Last Thursday at 11:45 AM".
	 * Similar to calendar in moment.js, but with time zone support.
	 * @param {(string|number)} [zone=system] - 'system' (for browser-default time zone),
	 * 'utc' (for UTC), or specify a time zone as number of minutes past UTC
	 * @returns {string}
	 */
	calendar: function(zone) {
		// Zero out the hours, minutes, seconds and milliseconds - keeping only the date;
		// find the difference. Note that setHours() returns the same thing as getTime().
		var dateDiff = (new Date().setHours(0, 0, 0, 0) -
			new Date(this).setHours(0, 0, 0, 0)) / 8.64e7;
		switch (true) {
			case dateDiff === 0:
				return this.format(xdate.localeData.relativeTimes.thisDay, zone);
			case dateDiff === 1:
				return this.format(xdate.localeData.relativeTimes.prevDay, zone);
			case dateDiff > 0 && dateDiff < 7:
				return this.format(xdate.localeData.relativeTimes.pastWeek, zone);
			case dateDiff === -1:
				return this.format(xdate.localeData.relativeTimes.nextDay, zone);
			case dateDiff < 0 && dateDiff > -7:
				return this.format(xdate.localeData.relativeTimes.thisWeek, zone);
			default:
				return this.format(xdate.localeData.relativeTimes.other, zone);
		}
	},

	/**
	 * @returns {RegExp} that matches wikitext section titles such as ==December 2019== or
	 * === Jan 2018 ===
	 */
	monthHeaderRegex: function() {
		return new RegExp('^==+\\s*(?:' + this.getUTCMonthName() + '|' + this.getUTCMonthNameAbbrev() +
			')\\s+' + this.getUTCFullYear() + '\\s*==+', 'mg');
	},

	/**
	 * Creates a wikitext section header with the month and year.
	 * @param {number} [level=2] - Header level (default 2)
	 * @returns {string}
	 */
	monthHeader: function(level) {
		level = level || 2;
		var header = Array(level + 1).join('='); // String.prototype.repeat not supported in IE 11
		return header + ' ' + this.getUTCMonthName() + ' ' + this.getUTCFullYear() + ' ' + header;
	}

});


/**
 * **************** unbinder ****************
 * Used for temporarily hiding a part of a string while processing the rest of it.
 *
 * eg.  var u = new unbinder("Hello world <!-- world --> world");
 *      u.unbind('<!--','-->');
 *      u.content = u.content.replace(/world/g, 'earth');
 *      u.rebind(); // gives "Hello earth <!-- world --> earth"
 *
 * Text within the 'unbinded' part (in this case, the HTML comment) remains intact
 * unbind() can be called multiple times to unbind multiple parts of the string.
 *
 * Used by Morebits.wikitext.page.commentOutImage
 */

/**
 * @constructor
 * @param {string} string
 */
var xunbinder = function Unbinder(string) {
	if (typeof string !== 'string') {
		throw new Error('not a string');
	}
	this.content = string;
	this.counter = 0;
	this.history = {};
	this.prefix = '%UNIQ::' + Math.random() + '::';
	this.postfix = '::UNIQ%';
};

xunbinder.prototype = {
	/**
	 * @param {string} prefix
	 * @param {string} postfix
	 */
	unbind: function UnbinderUnbind(prefix, postfix) {
		var re = new RegExp(prefix + '([\\s\\S]*?)' + postfix, 'g');
		this.content = this.content.replace(re, xunbinder.getCallback(this));
	},

	/** @returns {string} The output */
	rebind: function UnbinderRebind() {
		var content = this.content;
		content.self = this;
		for (var current in this.history) {
			if (Object.prototype.hasOwnProperty.call(this.history, current)) {
				content = content.replace(current, this.history[current]);
			}
		}
		return content;
	},
	prefix: null, // %UNIQ::0.5955981644938324::
	postfix: null, // ::UNIQ%
	content: null, // string
	counter: null, // 0++
	history: null // {}
};

xunbinder.getCallback = function UnbinderGetCallback(self) {
	return function UnbinderCallback(match) {
		var current = self.prefix + self.counter + self.postfix;
		self.history[current] = match;
		++self.counter;
		return current;
	};
};

module.exports = xdate;