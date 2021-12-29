const {MatrixClient, LogService, LogLevel, UserID} = require("matrix-bot-sdk");
const readline = require("readline-sync");

// Load settings - see settings.js.sample
Settings = require("./settings.js");

// Connect to the matrix
const theMatrix = new MatrixClient(Settings.matrixServerURL, Settings.accessToken);
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
	return roomObj.createObj['content']['creator'] === Settings.username;
}

// Add or replace the prefix on a name or alias.
// Used so that we can run the script multiple times and not get repeated prefixes.
function addOrReplacePrefix(name, prefixSeperator)
{
	const pos = name.indexOf(prefixSeperator)
	if(pos >= 0)
	{
		// Check if our prefix lengths match.
		if(pos == Settings.targetPrefix.length)
		{
			const s = name.substring(0, pos);
			// Dirty check for numeric value - parse the string as an integer and then check if that matches with the original string.
			if(parseInt(s) == s)
			{
				name=name.substr(pos + prefixSeperator.length);
			}
		}
	}

	return Settings.targetPrefix + prefixSeperator + name;
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
			changeData.addCanonicalAlias = true;
		}
		if(oldAliasList)
		{
			// NOTE: The alias list only contains PUBLISHED aliases.
			let newAliasList=[];
			let canonicalAliasFound=false;
			for(const alias of oldAliasList)
			{
				if(alias === oldCanonicalAlias)
					canonicalAliasFound = true;
				newAliasList[newAliasList.length]=addOrReplacePrefixForAlias(alias);
			}
			changeData.addCanonicalAlias = !canonicalAliasFound;
			changeData.oldAliasList = oldAliasList;
			changeData.newAliasList = newAliasList;
		}
	}

	// Find the Space that the room is in (if any).
	if(roomObj.parentObj)
	{
		changeData.parent = roomObj.parentObj['state_key'];
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
		roomObj.parentObj = stateObj.find(o => o['type'] === 'm.space.parent');
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
	for(let i = 0; i < oldAliasList.length; i++)
	{
		if(oldAliasList[i] != newAliasList[i])
		{
			try
			{
				await theMatrix.createRoomAlias(newAliasList[i], roomId);
			}
			catch(err) {}
			await theMatrix.deleteRoomAlias(oldAliasList[i]);
		}
	}
}

async function setSpaceChild(roomId, childId, via)
{
	setSpaceChildEvent = {};
	if(via)
		setSpaceChildEvent["via"] = via;

	await theMatrix.sendStateEvent(roomId, "m.space.child", childId, setSpaceChildEvent);
}

async function setSpaceParent(roomId, parentId, via)
{
	setSpaceParentEvent =
	{
		"via": via,
		"canonical": true,
	}

	await theMatrix.sendStateEvent(roomId, "m.space.parent", parentId, setSpaceParentEvent);
}

async function updateRoom(roomId, roomData)
{
	try
	{
		await setRoomName(roomId, roomData.newRoomName);

		if(roomData.newAliasList)
			await modifyRoomAliases(roomId, roomData.oldAliasList, roomData.newAliasList);

		if(roomData.addCanonicalAlias)
		{
			await modifyRoomAliases(roomId, [roomData.oldCanonicalAlias], [roomData.newCanonicalAlias]);
			roomData.newAliasList[roomData.newAliasList.length] = roomData.newCanonicalAlias;
		}

		if(roomData.newCanonicalAlias)
			await setRoomAliases(roomId, roomData.newCanonicalAlias, roomData.newAliasList);

		if(roomData.parent != Settings.targetSpace)
		{
			await setSpaceChild(Settings.targetSpace, roomId, Settings.targetVia);
			await setSpaceParent(roomId, Settings.targetSpace, Settings.targetVia);
			if(Settings.removeRoomFromOldSpace && roomData.parent)
			{
				// Remove from existing parent.
				await setSpaceChild(roomData.parent, roomId, undefined);
			}
		}
	}
	catch(err)
	{
		console.log("Error occurred updating Room %s (%s)", roomData.oldRoomName, roomId);
//		console.log(err);

		if(!readline.keyInYN("Do you want to continue to the next Room?"))
		{
			throw "Aborted by user";
		}
	}
}

function displayRoomData(roomId, roomData)
{
	console.log("Room Id: %s", roomId);
	console.log("Name: '%s' -> '%s'", roomData.oldRoomName, roomData.newRoomName);
	if(roomData.oldCanonicalAlias)
		console.log("Main Alias: '%s' -> '%s'", roomData.oldCanonicalAlias, roomData.newCanonicalAlias);
	if(roomData.oldAliasList)
	{
		console.log("Alias changes:");
		for(let i = 0; i < roomData.oldAliasList.length; i++)
		{
			console.log("  '%s' -> '%s'", roomData.oldAliasList[i], roomData.newAliasList[i]);
		}
	}
	if(roomData.parent)
		console.log("Parent space: '%s' -> '%s'", roomData.parent, Settings.targetSpace);
	else
		console.log("Parent space: <NONE> -> '%s'", Settings.targetSpace);

	console.log();
}


function updateRooms()
{
	console.log();
	console.log("Found %d rooms to change.", roomsToChange.size);
	console.log("Proposed Changes:");
	console.log();

	// Display the list of proposed changes
	roomsToChange.forEach(function(roomData, roomId) { displayRoomData(roomId, roomData); })

	if(readline.keyInYN("Do you want to set this?"))
	{
		let count = 1;
		let totalCount = roomsToChange.size;
		roomsToChange.forEach(function(roomData, roomId) { displayProgress(count++, totalCount, roomId + " - " + roomData.oldRoomName + " -> " + roomData.newRoomName); updateRoom(roomId, roomData); });
	}
	else
	{
		throw "Aborted by user";
	}
}

enumerateRooms();

