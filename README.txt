========================================================================
SYNCWATCH - LOCAL RUN INSTRUCTIONS
========================================================================

SyncWatch allows you to watch torrent streams or local video files in
perfect real-time synchronization with your friends. 

This file details the steps to set up and run the application locally on
your machine.

------------------------------------------------------------------------
1. REQUIREMENTS
------------------------------------------------------------------------
- Node.js version 18 or newer.
  (If you don't have it in the project directory, download and install it from https://nodejs.org)

------------------------------------------------------------------------
2. QUICK START (RUN LOCALLY)
------------------------------------------------------------------------
Follow these steps to run the server:

1. Open your terminal or Command Prompt in this folder.
2. Install the necessary dependencies (only needed the first time):
   
   npm install

3. Start the application:

   npm start

4. Open your web browser and navigate to:

   http://localhost:4173

* IMPORTANT: Keep the terminal window open while watching. Closing the
  terminal will stop the local video streaming server.

------------------------------------------------------------------------
3. HOW TO PLAY VIDEOS WITH FRIENDS
------------------------------------------------------------------------

A. STREAM A TORRENT:
--------------------
1. Select "Stream Torrent" as the Playback Source.
2. Paste the Torrent Magnet Link of the video.
3. Click "Create Room" to start the sync session.
4. Copy the Room Code and send it to your friends.
5. The backend will automatically stop seeding (uploading) as soon as the
   download reaches 100% to save your network bandwidth.

B. SYNC A LOCAL VIDEO FILE (NO DOWNLOAD TIME):
----------------------------------------------
If you and your friends already have the same video file on your hard drives,
you can use local mode:
1. Select "Sync Local File" as the Playback Source.
2. Choose your local video file.
3. Click "Create Room".
4. When your friends join, they will be prompted to select their copy of 
   the same local file.
5. Playback events (play, pause, seek) will sync instantly with zero server
   bandwidth usage.

------------------------------------------------------------------------
4. KEY NOTES & COMPATIBILITY
------------------------------------------------------------------------
- SUPPORTED FORMATS: Standard MP4 and WebM video files are supported.
- UNSUPPORTED FORMATS: MKV (.mkv) files are NOT supported. Modern browsers
  (like Google Chrome) cannot decode the proprietary AC-3/DTS audio codecs
  commonly found in MKV files, resulting in silent playback. Please use 
  MP4 or WebM formats.

------------------------------------------------------------------------
5. TRAVERSING STRICT FIREWALLS / DIFFERENT NETWORKS (TURN CONFIG)
------------------------------------------------------------------------
SyncWatch connects browsers directly peer-to-peer (P2P). If someone tries 
to join from another network (e.g. mobile data, university WiFi, or a 
different ISP) and gets a "disconnected from host" message, you need a 
TURN server to relay the connection:

1. Register for a free account on a TURN provider website like:
   https://www.metered.ca
2. Copy the credentials JSON block under your account dashboard.
3. On the SyncWatch landing page, expand "Advanced WebRTC Settings (STUN/TURN)".
4. Paste the credentials JSON block and click "Save Configuration".
5. Make sure both the Host and all Joining Members save this config on 
   their browsers.

------------------------------------------------------------------------
Enjoy your sync session!
========================================================================
