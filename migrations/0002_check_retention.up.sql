-- The worker deletes checks older than CHECK_RETENTION_DAYS. checks is append-only
-- in checked_at order, so a BRIN index (a few pages for millions of rows) is enough
-- to find the old end of the table without a second full B-tree.
CREATE INDEX checks_checked_at_brin ON checks USING brin (checked_at);
