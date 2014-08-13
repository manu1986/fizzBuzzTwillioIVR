package com.nowoncloud.fizzbuzz.service;

import com.nowoncloud.fizzbuzz.domain.FizzBuzzCallEntity;
import com.twilio.sdk.TwilioRestException;
import com.twilio.sdk.verbs.TwiMLException;

public interface CallService  {

	public void scheduleCall(FizzBuzzCallEntity call) throws TwilioRestException;

	void scheduleCall();

	String respondWithGameMenu() throws TwiMLException;

	String respondWithFizzBuzzSequence(String fizzBuzzEndPoint, String fizzBuzzStartingPoint, String callSid) throws TwiMLException;

	void makeCall(FizzBuzzCallEntity fizzBuzzCall) throws TwilioRestException;
	
}
