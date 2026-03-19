-- Mission Control — Enable Realtime on Tasks
-- Run this in the Supabase SQL Editor

-- This tells Supabase to broadcast insert, update, and delete events for the tasks table
alter publication supabase_realtime add table tasks;
