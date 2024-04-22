
CREATE TABLE alerts(
    name VARCHAR(255) PRIMARY KEY,
    lastEmailed TIMESTAMP
);

ALTER TABLE alerts ADD webKey CHAR(128);
ALTER TABLE alerts ADD paused timestamp null;
