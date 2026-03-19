-- Mission Control — Enable Realtime on Memories
-- Run this in the Supabase SQL Editor

-- Enable realtime broadcasts for the exact tier-3 memories Gravity Claw writes to
alter publication supabase_realtime add table memories;
