# FOSDEMRoomMatrixHack
Update existing FOSDEM Room aliases to include the year

Pre-requisites:
- npm
- nodejs

INSTALLATION:

- Clone the code
- Run 'npm install' to install the required javascript libraries
- Copy accesstoken.js.sample to accesstoken.js and modify appropriately.
- Run 'node ./botcode.js' to run the code.


*Initial goal:*
- Move the 2021 FOSDEM talk rooms into the 2021 FOSDEM Space, and update their alises so they have the year prepended so they don't block future talk room creation.

*Design:*
- Fosdem Conference bot gets all rooms it is in.
- for each room:
  -	Ensure it is a valid FOSDEM talk room
    -		Ensure it is NOT in the FOSDEM Home Space (#home:fosdem.org)
    -		Ensure that the Conference bot created the room
  -	Get room name
  -	Get canonical alias
  -	Get other aliases
  -	(locally)
    -		Update the room name with the year prepended.
    -		Strip any year prefix from all aliases
    -		Prepend year prefix to all aliases
  -	Push updated room name
  -	Push pdated alias list
  -	Push updated canonical alias
  -	Push room to the 2021 FOSDEM Space


