#!/bin/bash
journalctl -u docker.service --no-pager | tail -n 20
