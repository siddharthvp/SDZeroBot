CREATE TABLE IF NOT EXISTS dbreports(
    page VARCHAR(255),
    idx SMALLINT UNSIGNED,
    templateMd5 CHAR(32),
    intervalDays SMALLINT UNSIGNED,
    lastUpdate DATETIME
);
# TODO: database indexes and primary key
