-- Close, without saving, every open Word document under one oracle run directory.
-- usage: osascript close-run.applescript <runDir/>
-- Other documents (including other agents' and the user's) are left alone; Word is never quit.
on run argv
	set prefix to item 1 of argv
	set closed to 0
	with timeout of 30 seconds
		tell application "Microsoft Word"
			repeat with i from (count documents) to 1 by -1
				try
					if (posix full name of document i) starts with prefix then
						close document i saving no
						set closed to closed + 1
					end if
				end try
			end repeat
		end tell
	end timeout
	return closed as text
end run
