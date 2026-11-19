-- Cheapest Apple Event that proves this process may automate Word (fails with -1743 if not).
with timeout of 60 seconds
	tell application "Microsoft Word" to return (count documents) as text
end timeout
