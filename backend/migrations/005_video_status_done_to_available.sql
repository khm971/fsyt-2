-- Change video status from 'done' to 'available'
UPDATE video SET status = 'available' WHERE status = 'done';
