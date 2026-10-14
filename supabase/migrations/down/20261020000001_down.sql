-- Down migration for 20261020000001_access_requests.sql
--
-- WARNING: drops every access request (business contacts and their
-- status). Export access_requests first if any are still to be handled.

BEGIN;

DROP TABLE IF EXISTS access_requests;

COMMIT;
