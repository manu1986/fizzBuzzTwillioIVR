fizzBuzzTwillioIVR
==================

This is a Spring 3 MVC WebApp which does the following:<br />
1) Takes in a number to dial <br />
2) Dials the number and gets a number as input from the user <br />
3) Generates a Fizz-Buzz sequence and reads it out to the user. <br />

Users can also schedule calls for later (1min - 60mins) too.

Technologies
======================
<ol>
   <li>Spring 3 MVC</li>
   <li>Hibernate ORM</li>
   <li>MySql database</li>
   <li>Twillio Java SDK</li>
   <li>log4j for logging</li>
</ol>

Design
=====================
<ol>
<li> User enters the call delay and number to call and submits the form.</li>
<li> If the call delay is 0 then Twillio API for making a call are used to call the supplied number.<br /> &nbsp;&nbsp;&nbsp;&nbsp;2.1. Twillio's API returns a call session id which we save in the database with other call related info. <br />
&nbsp;&nbsp;&nbsp;&nbsp;2.2. If the call delay is greater than 0 and less than 60 then call related details are saved in database for scheduler to use<br />
&nbsp;&nbsp;&nbsp;&nbsp;2.3. Once the call is connected, twillio contacts FizzBuzz App to get a menu which is read out to user<br />
&nbsp;&nbsp;&nbsp;&nbsp;2.4. User enters a number on their phone<br />
&nbsp;&nbsp;&nbsp;&nbsp;2.5. Twillio supplies this number to FizzBuzz App and a fizzbuzz sequence is returned as response from the FizzBuzz App<br />
&nbsp;&nbsp;&nbsp;&nbsp;2.6. FizzBuzz App updates the database row for this call with the fizzbuzz number provided by twillio. Calls's session id is used to find the row in the database correspoonding to this call.<br />
</ol>


Improvements
======================
<ul>
   <li>Better exception handling</li>
   <li>mysql table optimizations using querys explain plan</li>
   <li>Database connection pooling</li>
   <li>Better error status's </li>
   <li>Better frontend</li>
</ul>
