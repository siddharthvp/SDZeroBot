REPLACE INTO nominators VALUES('Algonquin Round Table', 'Otto4711', '2007-09-08', '2022-08-06');
REPLACE INTO nominators VALUES('Georgetown Hoyas', 'Mareino', '2006-04-05', '2022-08-06');
REPLACE INTO nominators VALUES('Finn the Human and Jake the Dog', 'Gen. Quon', '2014-01-12', '2023-02-23');
REPLACE INTO nominators VALUES('K-43 (Kansas highway)', 'TCN7JM', '2013-02-11', '2022-08-06');
REPLACE INTO nominators VALUES('James L. Buie', 'Doug Coldwell', '2022-08-03', '2022-08-06');
REPLACE INTO nominators VALUES('Forge Park/495 station', 'Pi.1415926535', '2022-12-24', '2023-05-25');
REPLACE INTO nominators VALUES('Ruiner Pinball', 'KGRAMR', '2024-03-09', '2024-04-24');

-- should have worked but showing epoch time atm
REPLACE INTO nominators VALUES('Serious Sam: The First Encounter', 'IceWelder', '2023-10-30', '2024-02-04');
REPLACE INTO nominators VALUES('The Wing of Madoola', 'KGRAMR', '2023-12-28', '2024-04-24');

UPDATE nominators SET nominator = 'Tim O''Doherty' WHERE nominator = 'Tim O&';
