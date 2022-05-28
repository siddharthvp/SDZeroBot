CREATE TABLE IF NOT EXISTS g13(
    name VARCHAR(255) UNIQUE,
    description VARCHAR(255),
    excerpt BLOB,
    size INT,
    ts TIMESTAMP NOT NULL
) COLLATE 'utf8_unicode_ci'
-- use utf8_unicode_ci so that MariaDb allows a varchar(255) field to have unique constraint
-- max index column size is 767 bytes. 255*3 = 765 bytes with utf8, 255*4 = 1020 bytes with utf8mb4
