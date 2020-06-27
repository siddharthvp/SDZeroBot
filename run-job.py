import sys
import subprocess

try:
	runjob = sys.argv[1]
except IndexError:
	print('USAGE: python run-task.py <jobname>')
	sys.exit(1)

with open('~/SDZeroBot/crontab', 'r') as crontab:
	lines = crontab.read().splitlines() 
	lines = [line for line in lines if not line.startswith('#') and line.strip() is not '']
	for line in lines:
		job = line.split()[8]
		if job == runjob or job[4:] == runjob:
			command = line.split()[5:]
			print('> ' + ' '.join(command))
			subprocess.run(command)
			break