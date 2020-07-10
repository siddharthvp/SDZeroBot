#!/usr/bin/python3

import sys
import os

try:
	runjob = sys.argv[1].lower()
except IndexError:
	print('USAGE: python run-task.py <jobname>')
	sys.exit(1)

with open('/data/project/sdzerobot/SDZeroBot/crontab', 'r') as crontab:
	lines = crontab.read().splitlines() 
	lines = [line for line in lines if not line.startswith('#') and line.strip() is not '']
	for line in lines:
		job = line.split()[8].lower()
		if job[4:] == runjob:
			command = ' '.join(line.split()[5:])
			print('> ' + command)
			os.popen(command)
			break
