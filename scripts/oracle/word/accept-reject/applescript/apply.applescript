-- Accept All or Reject All on one staged document, then Save As a new .docx.
-- usage: osascript apply.applescript <input.docx> <accept|reject> <output.docx> <timeoutSeconds>
-- Both paths must be absolute and inside Word's container, so Word never asks for file access.
-- Closes only the documents at these two paths; never quits Word.
on run argv
	set inPath to item 1 of argv
	set mode to item 2 of argv
	set outPath to item 3 of argv
	set waitSeconds to (item 4 of argv) as integer
	with timeout of waitSeconds seconds
		tell application "Microsoft Word"
			open (POSIX file inPath)
			set target to missing value
			repeat 80 times
				repeat with i from 1 to (count documents)
					try
						if (posix full name of document i) is inPath then set target to document i
					end try
				end repeat
				if target is not missing value then exit repeat
				delay 0.25
			end repeat
			if target is missing value then return "NOT FOUND"
			try
				if mode is "accept" then
					accept all revisions target
				else
					reject all revisions target
				end if
				save as target file name outPath file format format document
			on error errMsg number errNum
				my closePaths({inPath, outPath})
				error errMsg number errNum
			end try
		end tell
		my closePaths({inPath, outPath})
	end timeout
	return "OK"
end run

on closePaths(paths)
	tell application "Microsoft Word"
		repeat with i from (count documents) to 1 by -1
			try
				if paths contains (posix full name of document i) then close document i saving no
			end try
		end repeat
	end tell
end closePaths
