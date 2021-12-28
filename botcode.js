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

function displayProgress(count, total, info)
{
	console.log("%s%: [%s/%s] %s", String(Math.round((count / total)*100)).padStart(3), String(count).padStart(String(total).length), total, info);
}

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
		// Check if our prefix lengths match.
		if(pos == newPrefix.length)
		{
			const s = name.substring(0, pos);
			// Dirty check for numeric value - parse the string as an integer and then check if that matches with the original string.
			if(parseInt(s) == s)
			{
				name=name.substr(pos + prefixSeperator.length);
			}
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
	return '#' + addOrReplacePrefix(alias.substr(1), '-');
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
		const oldAliasList = roomObj.aliasObj['content']['alt_aliases'];

		if(oldCanonicalAlias)
		{
			changeData.oldCanonicalAlias = oldCanonicalAlias;
			changeData.newCanonicalAlias = addOrReplacePrefixForAlias(oldCanonicalAlias);
		}
		if(oldAliasList)
		{
			// NOTE: The alias list only contains PUBLISHED aliases.
			let newAliasList=[];
			for(const alias of oldAliasList)
			{
				newAliasList[newAliasList.length]=addOrReplacePrefixForAlias(alias);
			}
			changeData.oldAliasList = oldAliasList;
			changeData.newAliasList = newAliasList;
		}
	}

	roomsToChange.set(roomObj.roomId, changeData);
}

async function enumerateRooms()
{
	// Get all the rooms we are in
	const joinedRoomIds = await theMatrix.getJoinedRooms();
	const totalRoomCount = joinedRoomIds.length;
	let thisRoomCount = 0;
	const stringRoomCount = String(totalRoomCount);

	for(const roomId of joinedRoomIds)
	{
		thisRoomCount++;
		displayProgress(thisRoomCount, totalRoomCount, roomId);
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

async function setRoomName(roomId, newName)
{
	setRoomNameEvent =
	{
		"name": newName,
	}

	await theMatrix.sendStateEvent(roomId, "m.room.name", "", setRoomNameEvent);
}

async function setRoomAliases(roomId, canonicalAlias, aliasList)
{
	setCanonicalAliasEvent = {}
	if(canonicalAlias)
	{
		setCanonicalAliasEvent["alias"] = canonicalAlias;
	}
	if(aliasList)
	{
		setCanonicalAliasEvent["alt_aliases"] = aliasList;
	}
	await theMatrix.sendStateEvent(roomId, "m.room.canonical_alias", "", setCanonicalAliasEvent);
}

async function modifyRoomAliases(roomId, oldAliasList, newAliasList)
{
	for(const alias of oldAliasList)
	{
		await theMatrix.deleteRoomAlias(alias);
	}
	for(const alias of newAliasList)
	{
		await theMatrix.createRoomAlias(alias, roomId);
	}
}


async function updateRoom(roomId, roomData)
{
	await setRoomName(roomId, roomData.newRoomName);

	if(roomData.newAliasList)
		await modifyRoomAliases(roomId, roomData.oldAliasList, roomData.newAliasList);

	if(roomData.newCanonicalAlias)
		await setRoomAliases(roomId, roomData.newCanonicalAlias, roomData.newAliasList);
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
		let count = 1;
		let totalCount = roomsToChange.size;
		roomsToChange.forEach(function(roomData, roomId) { displayProgress(count++, totalCount, roomId + " - " + roomData.oldRoomName + " -> " + roomData.newRoomName); updateRoom(roomId, roomData); });
	}
}

enumerateRooms();

