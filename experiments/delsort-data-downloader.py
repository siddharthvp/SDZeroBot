"""
Script to create a training dataset for creating ML algorithm to
automatically do deletion sorting and tagging.
"""
import pywikibot as pwb
from pywikibot import pagegenerators
import re
import json
import html

site = pwb.Site('en', 'wikipedia')

articleRe = re.compile(r'===\[\[:?(.*?)\]\]===')
archiveTitleRe = re.compile(r'Wikipedia:WikiProject Deletion sorting\/(.*?)/archive(\d+)?')

for archive in pagegenerators.SearchPageGenerator('intitle:archive prefix:"Wikipedia:WikiProject Deletion sorting/"'):

	print('\n\nPROCESSING: ' + archive.title() + '\n\n')
	match = archiveTitleRe.search(archive.title())
	if match is None:
		print('Failed to create archive page name: ' + archive.title())
		continue

	filename = match.group(1) + match.group(2) if match.group(2) is not None else match.group(1)

	data = []
	articlesNotParsed = []
	for p in archive.linkedPages(namespaces=4, content=True):
		if not p.title().startswith('Wikipedia:Articles for deletion/'):
			continue
		print('Processing ' + p.title())
		match = articleRe.search(p.text)
		if match:
			articleName = match.group(1)
			article = pwb.Page(site, articleName)

			articleText = None
			if article.exists():
				articleText = article.text
			else:
				for rev in article.loadDeletedRevisions(total=1):
					articleText = article.getDeletedRevision(rev, content=True)['text']

			# TODO: better preprocess the text before storing in file
			articleText = html.unescape(articleText)
			articleText = re.sub('<br ?/?>', ' ', articleText, flags=re.I)
			articleText = re.sub("''+", "", articleText)

			data.append((article.title(), articleText))
		else:
			articlesNotParsed.append(p.title())

	with open('delsort-data/' + filename + '.json', 'w') as outfile:
		json.dump(data, outfile, indent='\t')
	with open('delsort-data/' + filename + '.err', 'w') as errfile:
		errfile.write('\n'.join(articlesNotParsed))
