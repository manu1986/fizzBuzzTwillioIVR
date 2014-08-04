package com.nowoncloud.fizzbuzz;

import java.io.IOException;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.validation.Valid;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.validation.BindingResult;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.context.WebApplicationContext;

import com.nowoncloud.fizzbuzz.model.FizzBuzzCall;
import com.nowoncloud.fizzbuzz.service.CallService;
import com.nowoncloud.fizzbuzz.service.FizzBuzzGameService;
import com.twilio.sdk.TwilioRestException;
import com.twilio.sdk.verbs.TwiMLException;

@Controller
public class CallController {

	@Autowired
	private WebApplicationContext context;
	
	@Autowired
	CallService callService;

	@Autowired
	FizzBuzzGameService fizzBuzzGameService;
	
	@RequestMapping(value = "/", method = RequestMethod.GET)
	public String home(Model model) {
		model.addAttribute("call", new FizzBuzzCall());
		return "index";
	}
	
	@RequestMapping(value = "/call", method = RequestMethod.POST)
	public String call(@Valid @ModelAttribute("call") FizzBuzzCall call, BindingResult bindingResult, Model model) throws TwilioRestException {
		if (bindingResult.hasErrors()) {
            return "index";
        }
		model.addAttribute("call", call);
		callService.scheduleCall(call);
        return "callSuccess";
	}

	@RequestMapping(value = "/GameMenu", method = RequestMethod.GET)
	public void readGameMenu(HttpServletResponse response) throws TwiMLException, IOException {
		response.setContentType("application/xml");
		response.getWriter().print(callService.respondWithGameMenu());
	}
	
	@RequestMapping(value = "/GameMenuResponse", method = RequestMethod.POST)
	public void getGameMenuResponse(HttpServletRequest request, HttpServletResponse response) throws IOException, TwiMLException {
		response.setContentType("application/xml");
		String seq = fizzBuzzGameService.getFizzBuzzSeq(request.getParameter("Digits"));
		response.getWriter().print(callService
				    .respondWithFizzBuzzSequence(
				        request.getParameter("Digits"), seq, 
				        request.getParameter("CallSid")));
	}
	
}
