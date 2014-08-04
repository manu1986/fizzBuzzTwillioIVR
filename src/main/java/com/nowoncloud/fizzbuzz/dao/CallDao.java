package com.nowoncloud.fizzbuzz.dao;

import java.util.List;

import com.nowoncloud.fizzbuzz.model.FizzBuzzCall;

public interface CallDao {

	public void createCall(FizzBuzzCall call);
	
	public void updateCall(int fizzBuzzStartingPoint, String callSid);

	public List<FizzBuzzCall> getCallsWithExpiredDelays();
	
}
