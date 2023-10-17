SELECT cl_from AS subcat, page_id AS parentcat
FROM categorylinks
JOIN page ON page_namespace = 14 AND page_title = cl_to
WHERE cl_type = 'subcat';
