@echo off
rem Lens Code word reader: runs lib\ocr.py on the Python packed with this library, isolated from any other Python on the computer.
"%~dp0..\python\python.exe" -I "%~dp0..\lib\ocr.py" %*
