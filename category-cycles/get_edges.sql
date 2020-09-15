select cl_from as subcat, page_id as parentcat
from categorylinks
join page on page_namespace = 14 and page_title = cl_to
where cl_type = 'subcat';