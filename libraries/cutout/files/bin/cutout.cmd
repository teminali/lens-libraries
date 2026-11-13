@echo off
rem Lens Code cut-out engine: runs engine\cutout.mjs on the Node packed with this library.
"%~dp0..\node\node.exe" "%~dp0..\engine\cutout.mjs" %*
