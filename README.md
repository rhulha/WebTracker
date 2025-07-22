This is a web based music tracker.

The goal is to have multiple music projects but no logins.

So we need to make sure abuse is limited.

Every project is based on a random 12 char string.

The main page can start a new project.

When a new project is created a random 12 char string is generated and a new folder is created physically on disk in the "projects" folder.

Then a redirect happens or so and the project page is shown.

Here you can upload audio samples.

Every project is restricted to 10 MB total samples, so this needs to be checked.

Then when you are happy you can click on a link and open the tracker interface.

The tracker interface uses the samples to make music.

The tracker interface saves the music to the same folder on every change.

It would be nice to have a change history. So we need to append to the changes the new changes with a time stamp.

The music is just on or off at a specific time for a specific sample.

The main goal is to allow users to share the link with a friend or two and they can work on the music at the same time.

So we need some very simple form of UI sync.

