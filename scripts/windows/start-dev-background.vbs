' Starts `npm run dev` (embedded Postgres + Next.js on http://localhost:3100) as a hidden background process on Windows.
' Logs go to .devserver.log in the project root. Stop it with scripts\windows\stop-dev.ps1.
' Usage (from the project root):  wscript scripts\windows\start-dev-background.vbs
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)))
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = root
shell.Run "cmd /c npm run dev > .devserver.log 2>&1", 0, False
