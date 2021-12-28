const {MatrixClient, LogService, LogLevel, UserID} = require("matrix-bot-sdk");
const readline = require("readline-sync");

// The idea is that we are prepending a year on to room names and aliases.
// NOTE: We can oonly deal with numeric prefixes here
const newPrefix = "2021";

// Load credentials - see accesstoken.js.sample
Creds = require("./accesstoken.js");

// Connect to the matrix
const theMatrix = new MatrixClient(Creds.matrixServerURL, Creds.accessToken);
//LogService.setLevel(LogLevel.DEBUG);

roomsToChange=new Map();

function isValidRoomToChange(roomObj)
{
	if(!roomObj.createObj || !roomObj.nameObj)
		return false;

	// Do not change Spaces
	if(roomObj.createObj['content']['type'] === 'm.space')
		return false;

	// Check if the room creator matches
	return roomObj.createObj['content']['creator'] === Creds.username;
}

// Add or replace the prefix on a name or alias.
// Used so that we can run the script multiple times and not get repeated prefixes.
function addOrReplacePrefix(name, prefixSeperator)
{
	const pos = name.indexOf(prefixSeperator)
	if(pos >= 0)
	{
		const s = name.substring(0, pos);
		// Dirty check for numeric value - parse the string as an integer and then check if that matches with the original string.
		if(parseInt(s) == s)
		{
			name=name.substr(pos + prefixSeperator.length);
		}
	}

	return newPrefix + prefixSeperator + name;
}

function addOrReplacePrefixForName(name)
{
	return addOrReplacePrefix(name, ": ");
}

function addOrReplacePrefixForAlias(alias)
{
	return '#' + addOrReplacePrefix(alias.substr(1), '_-_');
}

function addRoomToChange(roomObj)
{
	const oldRoomName = roomObj.nameObj['content']['name'],
	changeData =
	{
		oldRoomName: oldRoomName,
		newRoomName: addOrReplacePrefixForName(oldRoomName),
	}
	
	if(roomObj.aliasObj)
	{
		const oldCanonicalAlias = roomObj.aliasObj['content']['alias'];
		const oldAliasList = roomObj.aliasObj['content']['alt_aliases'] || {};

		if(oldCanonicalAlias)
		{
			changeData.oldCanonicalAlias = oldCanonicalAlias;
			changeData.newCanonicalAlias = addOrReplacePrefixForAlias(oldCanonicalAlias);
		}
	}
//	console.log(roomObj.roomId);
//	console.log(roomObj.nameObj);
//	console.log(roomObj.aliasObj);
//	console.log(roomObj.createObj);

	roomsToChange.set(roomObj.roomId, changeData);
}

async function enumerateRooms()
{
	// Get all the rooms we are in
	const joinedRoomIds = await theMatrix.getJoinedRooms();
	const totalRoomCount = joinedRoomIds.length;
	let thisRoomCount = 0;

	for(const roomId of joinedRoomIds)
	{
		thisRoomCount++;
		console.log("%d%%: %s", Math.round((thisRoomCount / totalRoomCount)*100), roomId);
		// Get the state of each room.
		roomObj={roomId: roomId};

		const stateObj = await theMatrix.getRoomState(roomId);
		roomObj.nameObj = stateObj.find(o => o['type'] === 'm.room.name');
		roomObj.aliasObj = stateObj.find(o => o['type'] === 'm.room.canonical_alias');
		roomObj.createObj = stateObj.find(o => o['type'] === 'm.room.create');

		if(isValidRoomToChange(roomObj))
		{
			addRoomToChange(roomObj);
		}
	}

	updateRooms();
}

async function setRoomName(roomObj, newName)
{
	setRoomNameEvent =
	{
		"name": newName,
	}

	await theMatrix.sendStateEvent(roomObj.roomId, "m.room.name", "", setRoomNameEvent);
}

function updateRoom(roomId, roomData)
{
	console.log("Updateding room " + roomId);
	if(roomData.oldRoomName != roomData.newRoomName)
		setRoomName(roomId, roomData);
}

function updateRooms()
{
	console.log();
	console.log("Changes:");
	console.log();

	// Display the list of proposed changes
	roomsToChange.forEach(function(roomData, roomId) { console.log(roomId); console.log(roomData), console.log() })

	if(readline.keyInYN("Do you want to set this?"))
	{
//		roomsToChange.forEach(function(roomData, roomId) { updateRoom(roomId, roomData); });
	}
}

enumerateRooms();

