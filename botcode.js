const {MatrixClient, LogService, LogLevel, UserID} = require("matrix-bot-sdk");
const readline = require("readline-sync");

// The idea is that we are prepending a year on to room names and aliases.
const newPrefix = "2021";

// Load credentials - see accesstoken.js.sample
Creds = require("./accesstoken.js");

// Connect to the matrix
const theMatrix = new MatrixClient(Creds.matrixServerURL, Creds.accessToken);
LogService.setLevel(LogLevel.DEBUG);

roomsToChange=new Map();

function isValidRoomToChange(roomObj)
{
	if(!roomObj.createObj || !roomObj.nameObj)
		return false;

	// Do not change Spaces
	if(roomObj.createObj['content']['type'] === 'm.space')
		return false;

	return roomObj.createObj['content']['creator'] === Creds.username;
}

async function setRoomName(roomObj, newName)
{
	setRoomNameEvent =
	{
		"name": newName,
	}

	await theMatrix.sendStateEvent(roomObj.roomId, "m.room.name", "", setRoomNameEvent);
}

function addOrReplacePrefix(name, prefixSeperator)
{
	pos = name.indexOf(prefixSeperator)
	if(pos >= 0)
	{
		name=name.substr(pos + prefixSeperator.length);
	}

	return "" + newPrefix + prefixSeperator + name;
}

function changeRoom(roomObj)
{
	const oldRoomName = roomObj.nameObj['content']['name'],
	changeData =
	{
		oldRoomName: oldRoomName,
		newRoomName: addOrReplacePrefix(oldRoomName, ": "),
	}
	//setRoomName(roomObj, roomName);
	
	console.log(roomObj.roomId);
	console.log(roomObj.nameObj);
	console.log(roomObj.aliasObj);
	console.log(roomObj.createObj);

	roomsToChange.set(roomObj.roomId, changeData);
}

async function enumerateRooms()
{
	// Get all the rooms we are in
	const joinedRoomIds = await theMatrix.getJoinedRooms();

	for(const roomId of joinedRoomIds)
	{
		// Get the state of each room.
		roomObj={roomId: roomId};

		const stateObj = await theMatrix.getRoomState(roomId);
		roomObj.nameObj = stateObj.find(o => o['type'] === 'm.room.name');
		roomObj.aliasObj = stateObj.find(o => o['type'] === 'm.room.canonical_alias');
		roomObj.createObj = stateObj.find(o => o['type'] === 'm.room.create');

		if(isValidRoomToChange(roomObj))
		{
			changeRoom(roomObj);
		}
	}

	updateRooms();
}

function updateRoom(roomId, roomData)
{
	console.log("Updateding room " + roomId);
	if(roomData.oldRoomName != roomData.newRoomName)
		setRoomName(roomId, roomData);
}

function updateRooms()
{
	for(const roomInfo of roomsToChange.entries())
	{
		console.log(roomInfo);
	}
	if(readline.keyInYN("Do you want to set this?"))
	{
		roomsToChange.forEach(function(roomData, roomId) { updateRoom(roomId, roomData); });
	}
}

enumerateRooms();

console.log("Done!");

